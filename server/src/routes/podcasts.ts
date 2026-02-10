import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import { randomUUID } from 'crypto';
import { basename, join } from 'path';
import { existsSync, unlinkSync, writeFileSync } from 'fs';
import { requireAdmin, requireAuth } from '../plugins/auth.js';
import { db } from '../db/index.js';
import { isAdmin } from '../services/access.js';
import { podcastCreateSchema, podcastUpdateSchema } from '@harborfm/shared';
import { assertPathUnder, assertResolvedPathUnder, artworkDir } from '../services/paths.js';
import { MIMETYPE_TO_EXT } from '../utils/artwork.js';
import { writeRssFile } from '../services/rss.js';

function podcastRowWithFilename(row: Record<string, unknown>): Record<string, unknown> {
  const path = row.artwork_path as string | null | undefined;
  return { ...row, artwork_filename: path ? basename(path) : null };
}

export async function podcastRoutes(app: FastifyInstance) {
  const podcastListSelect = `
    SELECT id, owner_user_id, title, slug, description, language, author_name, owner_name,
           email, category_primary, category_secondary, category_tertiary, explicit, artwork_path, artwork_url, site_url,
           copyright, podcast_guid, locked, license, itunes_type, medium,
           created_at, updated_at,
           COALESCE(podcasts.max_episodes, (SELECT max_episodes FROM users WHERE id = podcasts.owner_user_id)) AS max_episodes,
           (SELECT COUNT(*) FROM episodes WHERE podcast_id = podcasts.id) AS episode_count
    FROM podcasts`;
  app.get('/api/podcasts', { preHandler: [requireAuth] }, async (request) => {
    const rows = db
      .prepare(`${podcastListSelect} WHERE owner_user_id = ? ORDER BY updated_at DESC`)
      .all(request.userId) as Record<string, unknown>[];
    return { podcasts: rows.map(podcastRowWithFilename) };
  });

  app.get('/api/podcasts/user/:userId', { preHandler: [requireAdmin] }, async (request) => {
    const { userId } = request.params as { userId: string };
    const rows = db
      .prepare(`${podcastListSelect} WHERE owner_user_id = ? ORDER BY updated_at DESC`)
      .all(userId) as Record<string, unknown>[];
    return { podcasts: rows.map(podcastRowWithFilename) };
  });

  app.post('/api/podcasts', { preHandler: [requireAuth] }, async (request, reply) => {
    const parsed = podcastCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
    }
    const userId = request.userId as string;
    const userRow = db.prepare('SELECT max_podcasts FROM users WHERE id = ?').get(userId) as { max_podcasts: number | null } | undefined;
    const maxPodcasts = userRow?.max_podcasts ?? null;
    if (maxPodcasts != null && maxPodcasts > 0) {
      const count = db.prepare('SELECT COUNT(*) as count FROM podcasts WHERE owner_user_id = ?').get(userId) as { count: number };
      if (count.count >= maxPodcasts) {
        return reply.status(403).send({
          error: `You have reached your limit of ${maxPodcasts} show${maxPodcasts === 1 ? '' : 's'}. You cannot create more.`,
        });
      }
    }
    const id = nanoid();
    const data = parsed.data;
    
    // Check if slug is already taken globally (required for public feed URLs)
    const existingSlug = db
      .prepare('SELECT id FROM podcasts WHERE slug = ?')
      .get(data.slug) as { id: string } | undefined;
    if (existingSlug) {
      return reply.status(409).send({ error: 'This slug is already taken. Please choose a different one.' });
    }
    
    // Generate podcast GUID automatically if not provided
    const podcastGuid = data.podcast_guid ?? randomUUID();
    const userDefaults = db.prepare('SELECT max_episodes FROM users WHERE id = ?').get(request.userId) as { max_episodes: number | null } | undefined;
    const defaultMaxEpisodes = userDefaults?.max_episodes ?? null;

    try {
      db.prepare(
        `INSERT INTO podcasts (
          id, owner_user_id, title, slug, description, language, author_name, owner_name,
          email, category_primary, category_secondary, category_tertiary, explicit, site_url, artwork_url,
          copyright, podcast_guid, locked, license, itunes_type, medium, max_episodes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        request.userId,
        data.title,
        data.slug,
        data.description ?? '',
        data.language ?? 'en',
        data.author_name ?? '',
        data.owner_name ?? '',
        data.email ?? '',
        data.category_primary ?? '',
        data.category_secondary ?? null,
        data.category_tertiary ?? null,
        data.explicit ?? 0,
        data.site_url ?? null,
        data.artwork_url ?? null,
        data.copyright ?? null,
        podcastGuid,
        data.locked ?? 0,
        data.license ?? null,
        data.itunes_type ?? 'episodic',
        data.medium ?? 'podcast',
        defaultMaxEpisodes
      );
    } catch (e) {
      const err = e as { message?: string };
      if (err.message?.includes('UNIQUE')) {
        return reply.status(409).send({ error: 'Slug already used for your account' });
      }
      throw e;
    }
    try {
      writeRssFile(id, null);
    } catch (_) {
      // non-fatal
    }
    const row = db.prepare('SELECT * FROM podcasts WHERE id = ?').get(id) as Record<string, unknown>;
    return reply.status(201).send(podcastRowWithFilename(row));
  });

  app.get('/api/podcasts/:id', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { userId } = request;
    const row = db
      .prepare(
        `SELECT podcasts.id, podcasts.owner_user_id, podcasts.title, podcasts.slug, podcasts.description,
         podcasts.language, podcasts.author_name, podcasts.owner_name, podcasts.email,
         podcasts.category_primary, podcasts.category_secondary, podcasts.category_tertiary,
         podcasts.explicit, podcasts.artwork_path, podcasts.artwork_url, podcasts.site_url,
         podcasts.copyright, podcasts.podcast_guid, podcasts.locked, podcasts.license,
         podcasts.itunes_type, podcasts.medium, podcasts.created_at, podcasts.updated_at,
         COALESCE(podcasts.max_episodes, (SELECT max_episodes FROM users WHERE id = podcasts.owner_user_id)) AS max_episodes,
         (SELECT COUNT(*) FROM episodes WHERE podcast_id = podcasts.id) AS episode_count
         FROM podcasts WHERE podcasts.id = ? AND (owner_user_id = ? OR (SELECT role FROM users WHERE id = ?) = 'admin')`
      )
      .get(id, userId, userId) as Record<string, unknown> | undefined;
    if (!row) return reply.status(404).send({ error: 'Podcast not found' });
    return podcastRowWithFilename(row);
  });

  app.get('/api/podcasts/:id/analytics', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id: podcastId } = request.params as { id: string };
    const { userId } = request;
    const podcast = db
      .prepare(
        `SELECT id FROM podcasts WHERE id = ? AND (owner_user_id = ? OR (SELECT role FROM users WHERE id = ?) = 'admin')`
      )
      .get(podcastId, userId, userId) as { id: string } | undefined;
    if (!podcast) return reply.status(404).send({ error: 'Podcast not found' });

    const rss_daily = db
      .prepare(
        `SELECT stat_date, bot_count, human_count FROM podcast_stats_rss_daily WHERE podcast_id = ? ORDER BY stat_date DESC`
      )
      .all(podcastId) as Array<{ stat_date: string; bot_count: number; human_count: number }>;

    const episodes = db
      .prepare(
        `SELECT id, title, slug FROM episodes WHERE podcast_id = ? ORDER BY COALESCE(publish_at, updated_at) DESC`
      )
      .all(podcastId) as Array<{ id: string; title: string; slug: string | null }>;

    const episodeIds = episodes.map((e) => e.id);
    const episode_daily: Array<{ episode_id: string; stat_date: string; bot_count: number; human_count: number }> = [];
    const episode_location_daily: Array<{
      episode_id: string;
      stat_date: string;
      location: string;
      bot_count: number;
      human_count: number;
    }> = [];
    const episode_listens_daily: Array<{
      episode_id: string;
      stat_date: string;
      bot_count: number;
      human_count: number;
    }> = [];

    if (episodeIds.length > 0) {
      const placeholders = episodeIds.map(() => '?').join(',');
      episode_daily.push(
        ...(db
          .prepare(
            `SELECT episode_id, stat_date, bot_count, human_count FROM podcast_stats_episode_daily WHERE episode_id IN (${placeholders}) ORDER BY stat_date DESC, episode_id`
          )
          .all(...episodeIds) as Array<{
            episode_id: string;
            stat_date: string;
            bot_count: number;
            human_count: number;
          }>)
      );
      episode_location_daily.push(
        ...(db
          .prepare(
            `SELECT episode_id, stat_date, location, bot_count, human_count FROM podcast_stats_episode_location_daily WHERE episode_id IN (${placeholders}) ORDER BY stat_date DESC, episode_id, location`
          )
          .all(...episodeIds) as Array<{
            episode_id: string;
            stat_date: string;
            location: string;
            bot_count: number;
            human_count: number;
          }>)
      );
      episode_listens_daily.push(
        ...(db
          .prepare(
            `SELECT episode_id, stat_date, bot_count, human_count FROM podcast_stats_episode_listens_daily WHERE episode_id IN (${placeholders}) ORDER BY stat_date DESC, episode_id`
          )
          .all(...episodeIds) as Array<{
            episode_id: string;
            stat_date: string;
            bot_count: number;
            human_count: number;
          }>)
      );
    }

    return {
      rss_daily,
      episodes,
      episode_daily,
      episode_location_daily,
      episode_listens_daily,
    };
  });

  app.patch('/api/podcasts/:id', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = podcastUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
    }
    const existing = db
      .prepare('SELECT id FROM podcasts WHERE id = ? AND owner_user_id = ?')
      .get(id, request.userId);
    if (!existing) return reply.status(404).send({ error: 'Podcast not found' });
    
    // Get current podcast to check slug changes
    const currentPodcast = db.prepare('SELECT slug FROM podcasts WHERE id = ?').get(id) as { slug: string } | undefined;
    if (!currentPodcast) return reply.status(404).send({ error: 'Podcast not found' });
    
    const data = parsed.data;
    const fields: string[] = [];
    const values: unknown[] = [];
    let oldArtworkPath: string | null = null;
    if (data.title !== undefined) {
      fields.push('title = ?');
      values.push(data.title);
    }
    if (data.slug !== undefined) {
      // Only admins can edit slugs after creation (only check if slug is actually changing)
      if (data.slug !== currentPodcast.slug && !isAdmin(request.userId)) {
        return reply.status(403).send({ error: 'Only administrators can edit slugs' });
      }
      // Check if slug is already taken globally (required for public feed URLs)
      if (data.slug !== currentPodcast.slug) {
        const existingSlug = db
          .prepare('SELECT id FROM podcasts WHERE slug = ? AND id != ?')
          .get(data.slug, id) as { id: string } | undefined;
        if (existingSlug) {
          return reply.status(409).send({ error: 'This slug is already taken. Please choose a different one.' });
        }
      }
      // Only update slug if it's actually different
      if (data.slug !== currentPodcast.slug) {
        fields.push('slug = ?');
        values.push(data.slug);
      }
    }
    if (data.description !== undefined) {
      fields.push('description = ?');
      values.push(data.description);
    }
    if (data.language !== undefined) {
      fields.push('language = ?');
      values.push(data.language);
    }
    if (data.author_name !== undefined) {
      fields.push('author_name = ?');
      values.push(data.author_name);
    }
    if (data.owner_name !== undefined) {
      fields.push('owner_name = ?');
      values.push(data.owner_name);
    }
    if (data.email !== undefined) {
      fields.push('email = ?');
      values.push(data.email);
    }
    if (data.category_primary !== undefined) {
      fields.push('category_primary = ?');
      values.push(data.category_primary);
    }
    if (data.category_secondary !== undefined) {
      fields.push('category_secondary = ?');
      values.push(data.category_secondary);
    }
    if (data.explicit !== undefined) {
      fields.push('explicit = ?');
      values.push(data.explicit);
    }
    if (data.site_url !== undefined) {
      fields.push('site_url = ?');
      values.push(data.site_url);
    }
    if (data.artwork_url !== undefined) {
      fields.push('artwork_url = ?');
      values.push(data.artwork_url);
      if (data.artwork_url && String(data.artwork_url).trim()) {
        fields.push('artwork_path = NULL');
        const row = db.prepare('SELECT artwork_path FROM podcasts WHERE id = ?').get(id) as { artwork_path: string | null } | undefined;
        if (row?.artwork_path) oldArtworkPath = row.artwork_path;
      }
    }
    if (data.copyright !== undefined) {
      fields.push('copyright = ?');
      values.push(data.copyright);
    }
    if (data.podcast_guid !== undefined) {
      fields.push('podcast_guid = ?');
      values.push(data.podcast_guid);
    }
    if (data.locked !== undefined) {
      fields.push('locked = ?');
      values.push(data.locked);
    }
    if (data.license !== undefined) {
      fields.push('license = ?');
      values.push(data.license);
    }
    if (data.itunes_type !== undefined) {
      fields.push('itunes_type = ?');
      values.push(data.itunes_type);
    }
    if (data.medium !== undefined) {
      fields.push('medium = ?');
      values.push(data.medium);
    }
    if (data.category_tertiary !== undefined) {
      fields.push('category_tertiary = ?');
      values.push(data.category_tertiary);
    }
    if (fields.length === 0) {
      const row = db.prepare('SELECT * FROM podcasts WHERE id = ?').get(id) as Record<string, unknown>;
      return podcastRowWithFilename(row);
    }
    fields.push("updated_at = datetime('now')");
    values.push(id);
    try {
      db.prepare(`UPDATE podcasts SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    } catch (e) {
      const err = e as { message?: string };
      if (err.message?.includes('UNIQUE')) {
        return reply.status(409).send({ error: 'Slug already used for your account' });
      }
      throw e;
    }
    try {
      writeRssFile(id, null);
    } catch (_) {
      // non-fatal: feed will regenerate on next save or episode change
    }
    if (oldArtworkPath) {
      try {
        const safeOld = assertPathUnder(oldArtworkPath, artworkDir(id));
        if (existsSync(safeOld)) unlinkSync(safeOld);
      } catch {
        // ignore: path invalid or already gone
      }
    }
    const row = db.prepare('SELECT * FROM podcasts WHERE id = ?').get(id) as Record<string, unknown>;
    return podcastRowWithFilename(row);
  });

  app.post('/api/podcasts/:id/artwork', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = db.prepare('SELECT id, artwork_path FROM podcasts WHERE id = ? AND owner_user_id = ?').get(id, request.userId) as { id: string; artwork_path: string | null } | undefined;
    if (!existing) return reply.status(404).send({ error: 'Podcast not found' });
    const data = await request.file();
    if (!data) return reply.status(400).send({ error: 'No file uploaded' });
    const mimetype = data.mimetype || '';
    if (!mimetype.startsWith('image/')) return reply.status(400).send({ error: 'Not an image' });
    const ext = MIMETYPE_TO_EXT[mimetype] ?? 'jpg';
    const dir = artworkDir(id);
    const filename = `${nanoid()}.${ext}`;
    const destPath = join(dir, filename);
    const buffer = await data.toBuffer();
    if (buffer.length > 5 * 1024 * 1024) return reply.status(400).send({ error: 'Image too large (max 5MB)' });
    assertResolvedPathUnder(destPath, dir);
    writeFileSync(destPath, buffer);
    db.prepare('UPDATE podcasts SET artwork_path = ?, artwork_url = NULL, updated_at = datetime(\'now\') WHERE id = ?').run(destPath, id);
    const oldPath = existing.artwork_path;
    if (oldPath && oldPath !== destPath) {
      try {
        const safeOld = assertPathUnder(oldPath, dir);
        if (existsSync(safeOld)) unlinkSync(safeOld);
      } catch {
        // ignore: path invalid or already gone
      }
    }
    const row = db.prepare('SELECT * FROM podcasts WHERE id = ?').get(id) as Record<string, unknown>;
    return podcastRowWithFilename(row);
  });
}
