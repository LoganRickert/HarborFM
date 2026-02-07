import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import { requireAuth } from '../plugins/auth.js';
import { db } from '../db/index.js';
import { episodeCreateSchema, episodeUpdateSchema } from '@harborfm/shared';
import { writeRssFile } from '../services/rss.js';

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function isAdmin(userId: string): boolean {
  const user = db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as { role: string } | undefined;
  return user?.role === 'admin';
}

function canAccessPodcast(db: import('better-sqlite3').Database, userId: string, podcastId: string): boolean {
  const row = db.prepare('SELECT id FROM podcasts WHERE id = ? AND owner_user_id = ?').get(podcastId, userId);
  return !!row;
}

export async function episodeRoutes(app: FastifyInstance) {
  app.get(
    '/api/podcasts/:podcastId/episodes',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { podcastId } = request.params as { podcastId: string };
      if (!canAccessPodcast(db, request.userId, podcastId) && !isAdmin(request.userId)) {
        return reply.status(404).send({ error: 'Podcast not found' });
      }
      const rows = db
        .prepare(
          `SELECT * FROM episodes WHERE podcast_id = ? ORDER BY created_at DESC`
        )
        .all(podcastId) as Record<string, unknown>[];
      return { episodes: rows };
    }
  );

  app.post(
    '/api/podcasts/:podcastId/episodes',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { podcastId } = request.params as { podcastId: string };
      if (!canAccessPodcast(db, request.userId, podcastId)) {
        return reply.status(404).send({ error: 'Podcast not found' });
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
      return reply.status(201).send(row);
    }
  );

  app.get('/api/episodes/:id', { preHandler: [requireAuth] }, async (request, reply) => {
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
    return row;
  });

  app.patch('/api/episodes/:id', { preHandler: [requireAuth] }, async (request, reply) => {
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
      artwork_url: data.artwork_url,
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
    const row = db.prepare('SELECT * FROM episodes WHERE id = ?').get(id) as Record<string, unknown>;
    const podcastId = (row as { podcast_id: string }).podcast_id;
    try {
      writeRssFile(podcastId, null);
    } catch (_) {
      // non-fatal
    }
    return row;
  });
}
