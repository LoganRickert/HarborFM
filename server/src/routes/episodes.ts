import type { FastifyInstance } from 'fastify';
import { existsSync, unlinkSync, writeFileSync } from 'fs';
import { basename, join } from 'path';
import { nanoid } from 'nanoid';
import { requireAuth, requireNotReadOnly } from '../plugins/auth.js';
import { db } from '../db/index.js';
import { isAdmin, canAccessPodcast } from '../services/access.js';
import { episodeCreateSchema, episodeUpdateSchema } from '@harborfm/shared';
import { writeRssFile } from '../services/rss.js';
import { assertPathUnder, assertResolvedPathUnder, artworkDir } from '../services/paths.js';
import { MIMETYPE_TO_EXT } from '../utils/artwork.js';

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function episodeRowWithFilename(row: Record<string, unknown>): Record<string, unknown> {
  const path = row.artwork_path as string | null | undefined;
  const podcastId = row.podcast_id as string | undefined;
  let artwork_filename: string | null = null;
  if (path && podcastId) {
    try {
      const dir = artworkDir(podcastId);
      assertPathUnder(path, dir);
      artwork_filename = basename(path);
    } catch {
      // path invalid or outside allowed dir: don't expose filename
    }
  }
  return { ...row, artwork_filename };
}

export async function episodeRoutes(app: FastifyInstance) {
  app.get(
    '/api/podcasts/:podcastId/episodes',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Episodes'],
        summary: 'List episodes',
        description: 'List episodes for a podcast. Must have access to the podcast.',
        params: { type: 'object', properties: { podcastId: { type: 'string' } }, required: ['podcastId'] },
        response: { 200: { description: 'List of episodes' }, 404: { description: 'Podcast not found' } },
      },
    },
    async (request, reply) => {
      const { podcastId } = request.params as { podcastId: string };
      if (!canAccessPodcast(request.userId, podcastId) && !isAdmin(request.userId)) {
        return reply.status(404).send({ error: 'Podcast not found' });
      }
      const rows = db
        .prepare(
          `SELECT * FROM episodes WHERE podcast_id = ? ORDER BY created_at DESC`
        )
        .all(podcastId) as Record<string, unknown>[];
      return { episodes: rows.map((r) => episodeRowWithFilename(r)) };
    }
  );

  app.post(
    '/api/podcasts/:podcastId/episodes',
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ['Episodes'],
        summary: 'Create episode',
        description: 'Create an episode for a podcast. Requires read-write access.',
        params: { type: 'object', properties: { podcastId: { type: 'string' } }, required: ['podcastId'] },
        body: { type: 'object', properties: { title: { type: 'string' }, description: { type: 'string' }, status: { type: 'string' } }, required: ['title'] },
        response: { 201: { description: 'Created episode' }, 400: { description: 'Validation failed' }, 403: { description: 'At limit or read-only' }, 404: { description: 'Podcast not found' } },
      },
    },
    async (request, reply) => {
      const { podcastId } = request.params as { podcastId: string };
      if (!canAccessPodcast(request.userId, podcastId)) {
        return reply.status(404).send({ error: 'Podcast not found' });
      }
      const userId = request.userId as string;
      const podcastRow = db.prepare('SELECT max_episodes FROM podcasts WHERE id = ?').get(podcastId) as { max_episodes: number | null } | undefined;
      const userRow = db.prepare('SELECT max_episodes FROM users WHERE id = ?').get(userId) as { max_episodes: number | null } | undefined;
      const maxEpisodes = podcastRow?.max_episodes ?? userRow?.max_episodes ?? null;
      if (maxEpisodes != null && maxEpisodes > 0) {
        const count = db.prepare('SELECT COUNT(*) as count FROM episodes WHERE podcast_id = ?').get(podcastId) as { count: number };
        if (count.count >= maxEpisodes) {
          return reply.status(403).send({
            error: `This show has reached its limit of ${maxEpisodes} episode${maxEpisodes === 1 ? '' : 's'}. You cannot create more.`,
          });
        }
      }
      const parsed = episodeCreateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
      }
      const id = nanoid();
      const guid = `urn:harborfm:episode:${id}`;
      const data = parsed.data;
      const slug = (data as { slug?: string }).slug || slugify(data.title);
      // Ensure slug is unique within podcast
      let finalSlug = slug;
      let counter = 1;
      while (db.prepare('SELECT id FROM episodes WHERE podcast_id = ? AND slug = ?').get(podcastId, finalSlug)) {
        finalSlug = `${slug}-${counter}`;
        counter++;
      }
      db.prepare(
        `INSERT INTO episodes (
          id, podcast_id, title, description, slug, guid, season_number, episode_number,
          episode_type, explicit, publish_at, status, artwork_url, episode_link, guid_is_permalink
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        podcastId,
        data.title,
        data.description ?? '',
        finalSlug,
        guid,
        data.season_number ?? null,
        data.episode_number ?? null,
        data.episode_type ?? null,
        data.explicit ?? null,
        data.publish_at ?? null,
        data.status ?? 'draft',
        data.artwork_url ?? null,
        (data as { episode_link?: string | null }).episode_link ?? null,
        (data as { guid_is_permalink?: 0 | 1 }).guid_is_permalink ?? 0
      );
      try {
        writeRssFile(podcastId, null);
      } catch (_) {
        // non-fatal
      }
      const row = db.prepare('SELECT * FROM episodes WHERE id = ?').get(id) as Record<string, unknown>;
      return reply.status(201).send(episodeRowWithFilename(row));
    }
  );

  app.get('/api/episodes/:id', {
    preHandler: [requireAuth],
    schema: {
      tags: ['Episodes'],
      summary: 'Get episode',
      description: 'Get an episode by ID. Must own the podcast or be admin.',
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      response: { 200: { description: 'Episode' }, 404: { description: 'Not found' } },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { userId } = request;
    const row = db
      .prepare(
        `SELECT e.* FROM episodes e
         JOIN podcasts p ON p.id = e.podcast_id
         WHERE e.id = ? AND (p.owner_user_id = ? OR (SELECT role FROM users WHERE id = ?) = 'admin')`
      )
      .get(id, userId, userId) as Record<string, unknown> | undefined;
    if (!row) return reply.status(404).send({ error: 'Episode not found' });
    return episodeRowWithFilename(row);
  });

  app.patch('/api/episodes/:id', {
    preHandler: [requireAuth, requireNotReadOnly],
    schema: {
      tags: ['Episodes'],
      summary: 'Update episode',
      description: 'Update episode metadata. Requires read-write access.',
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      body: { type: 'object', properties: { title: { type: 'string' }, description: { type: 'string' }, status: { type: 'string' } } },
      response: { 200: { description: 'Updated episode' }, 400: { description: 'Validation failed' }, 403: { description: 'Only admins can edit slugs' }, 404: { description: 'Not found' } },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = db
      .prepare(
        `SELECT e.id FROM episodes e
         JOIN podcasts p ON p.id = e.podcast_id
         WHERE e.id = ? AND p.owner_user_id = ?`
      )
      .get(id, request.userId);
    if (!existing) return reply.status(404).send({ error: 'Episode not found' });
    const parsed = episodeUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
    }
    const data = parsed.data;
    const fields: string[] = [];
    const values: unknown[] = [];
    const updateData = data as { slug?: string; title?: string };
    
    // Get current episode to ensure we have podcast_id and current title
    const currentEpisode = db.prepare('SELECT podcast_id, title, slug FROM episodes WHERE id = ?').get(id) as { podcast_id: string; title: string; slug: string } | undefined;
    if (!currentEpisode) return reply.status(404).send({ error: 'Episode not found' });
    
    // Only admins can explicitly edit slugs after creation
    // Allow auto-generation from title if slug is empty, but block explicit slug changes
    if (updateData.slug !== undefined && updateData.slug !== currentEpisode.slug && !isAdmin(request.userId)) {
      return reply.status(403).send({ error: 'Only administrators can edit slugs' });
    }
    
    // Ensure slug is always set - use provided slug, or generate from title (new or existing)
    const newTitle = data.title ?? currentEpisode.title;
    let finalSlug = updateData.slug || currentEpisode.slug;
    // Only auto-generate if slug is empty or missing, and user didn't explicitly provide one
    // If user explicitly provided a slug (even if same), respect it (admin check already done above)
    if (!finalSlug && updateData.slug === undefined) {
      // Generate slug from title if slug is empty and no explicit slug provided
      finalSlug = slugify(newTitle);
    }
    
    // Ensure slug is unique within podcast
    if (finalSlug !== currentEpisode.slug) {
      let uniqueSlug = finalSlug;
      let counter = 1;
      while (db.prepare('SELECT id FROM episodes WHERE podcast_id = ? AND slug = ? AND id != ?').get(currentEpisode.podcast_id, uniqueSlug, id)) {
        uniqueSlug = `${finalSlug}-${counter}`;
        counter++;
      }
      finalSlug = uniqueSlug;
    }
    
    let oldArtworkPath: string | null = null;
    if (data.artwork_url !== undefined) {
      fields.push('artwork_url = ?');
      values.push(
        data.artwork_url && String(data.artwork_url).trim() ? data.artwork_url : null
      );
      fields.push('artwork_path = NULL');
      const episodeRow = db.prepare('SELECT artwork_path FROM episodes WHERE id = ?').get(id) as { artwork_path: string | null } | undefined;
      if (episodeRow?.artwork_path) oldArtworkPath = episodeRow.artwork_path;
    }

    const map: Record<string, unknown> = {
      title: data.title,
      description: data.description,
      slug: finalSlug,
      season_number: data.season_number,
      episode_number: data.episode_number,
      episode_type: data.episode_type,
      explicit: data.explicit,
      publish_at: data.publish_at,
      status: data.status,
      episode_link: (data as { episode_link?: string | null }).episode_link,
      guid_is_permalink: (data as { guid_is_permalink?: 0 | 1 }).guid_is_permalink,
    };
    for (const [k, v] of Object.entries(map)) {
      if (v !== undefined) {
        fields.push(`${k} = ?`);
        // Convert empty string to null for URL fields
        if ((k === 'artwork_url' || k === 'episode_link') && v === '') {
          values.push(null);
        } else {
          values.push(v);
        }
      }
    }
    // Always ensure slug is updated (it's always set, but ensure it's included)
    if (!fields.some(f => f.startsWith('slug'))) {
      fields.push('slug = ?');
      values.push(finalSlug);
    }
    if (fields.length > 0) {
      fields.push("updated_at = datetime('now')");
      values.push(id);
      db.prepare(`UPDATE episodes SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    }
    if (oldArtworkPath) {
      try {
        const dir = artworkDir(currentEpisode.podcast_id);
        const safeOld = assertPathUnder(oldArtworkPath, dir);
        if (existsSync(safeOld)) unlinkSync(safeOld);
      } catch {
        // ignore
      }
    }
    const row = db.prepare('SELECT * FROM episodes WHERE id = ?').get(id) as Record<string, unknown>;
    const podcastId = (row as { podcast_id: string }).podcast_id;
    try {
      writeRssFile(podcastId, null);
    } catch (_) {
      // non-fatal
    }
    return episodeRowWithFilename(row);
  });

  app.post(
    '/api/podcasts/:podcastId/episodes/:episodeId/artwork',
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ['Episodes'],
        summary: 'Upload episode artwork',
        description: 'Upload episode cover image (multipart). Max 5MB. Requires read-write access.',
        params: { type: 'object', properties: { podcastId: { type: 'string' }, episodeId: { type: 'string' } }, required: ['podcastId', 'episodeId'] },
        response: { 200: { description: 'Artwork uploaded' }, 400: { description: 'No file or not image' }, 404: { description: 'Not found' } },
      },
    },
    async (request, reply) => {
      const { podcastId, episodeId } = request.params as { podcastId: string; episodeId: string };
      const existing = db
        .prepare(
          `SELECT e.id, e.artwork_path FROM episodes e
           JOIN podcasts p ON p.id = e.podcast_id
           WHERE e.id = ? AND e.podcast_id = ? AND p.owner_user_id = ?`
        )
        .get(episodeId, podcastId, request.userId) as { id: string; artwork_path: string | null } | undefined;
      if (!existing) return reply.status(404).send({ error: 'Episode not found' });
      const data = await request.file();
      if (!data) return reply.status(400).send({ error: 'No file uploaded' });
      const mimetype = data.mimetype || '';
      if (!mimetype.startsWith('image/')) return reply.status(400).send({ error: 'Not an image' });
      const ext = MIMETYPE_TO_EXT[mimetype] ?? 'jpg';
      const dir = artworkDir(podcastId);
      const filename = `${nanoid()}.${ext}`;
      const destPath = join(dir, filename);
      const buffer = await data.toBuffer();
      if (buffer.length > 5 * 1024 * 1024) return reply.status(400).send({ error: 'Image too large (max 5MB)' });
      assertResolvedPathUnder(destPath, dir);
      writeFileSync(destPath, buffer);
      db.prepare('UPDATE episodes SET artwork_path = ?, artwork_url = NULL, updated_at = datetime(\'now\') WHERE id = ?').run(destPath, episodeId);
      const oldPath = existing.artwork_path;
      if (oldPath && oldPath !== destPath) {
        try {
          const safeOld = assertPathUnder(oldPath, dir);
          if (existsSync(safeOld)) unlinkSync(safeOld);
        } catch {
          // ignore
        }
      }
      try {
        writeRssFile(podcastId, null);
      } catch (_) {
        // non-fatal
      }
      const row = db.prepare('SELECT * FROM episodes WHERE id = ?').get(episodeId) as Record<string, unknown>;
      return episodeRowWithFilename(row);
    }
  );
}
