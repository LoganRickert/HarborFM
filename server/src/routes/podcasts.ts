import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import { randomUUID } from 'crypto';
import { basename, join } from 'path';
import { existsSync, unlinkSync, writeFileSync } from 'fs';
import { requireAdmin, requireAuth, requireNotReadOnly } from '../plugins/auth.js';
import { db } from '../db/index.js';
import { isAdmin, getPodcastRole, canAccessPodcast, canEditEpisodeOrPodcastMetadata, canManageCollaborators, KNOWN_ROLES } from '../services/access.js';
import { wouldExceedStorageLimit } from '../services/storageLimit.js';
import { RECORD_MIN_FREE_BYTES, ARTWORK_MAX_BYTES, ARTWORK_MAX_MB } from '../config.js';
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
  app.get('/api/podcasts', {
    preHandler: [requireAuth],
    schema: {
      tags: ['Podcasts'],
      summary: 'List podcasts',
      description: 'List shows owned by or shared with the current user.',
      response: { 200: { description: 'List of podcasts' } },
    },
  }, async (request) => {
    const userId = request.userId as string;
    const owned = db
      .prepare(`${podcastListSelect} WHERE owner_user_id = ? ORDER BY updated_at DESC`)
      .all(userId) as Record<string, unknown>[];
    const shared = db
      .prepare(
        `${podcastListSelect}
         WHERE id IN (SELECT podcast_id FROM podcast_shares WHERE user_id = ?)
         ORDER BY updated_at DESC`
      )
      .all(userId) as Record<string, unknown>[];
    const ownedIds = new Set(owned.map((r) => r.id as string));
    const combined = [
      ...owned.map((r) => ({ ...podcastRowWithFilename(r), my_role: 'owner' as const, is_shared: false })),
      ...shared.filter((r) => !ownedIds.has(r.id as string)).map((r) => {
        const share = db.prepare('SELECT role FROM podcast_shares WHERE podcast_id = ? AND user_id = ?').get(r.id, userId) as { role: string } | undefined;
        return { ...podcastRowWithFilename(r), my_role: share?.role ?? 'view', is_shared: true };
      }),
    ].sort((a: Record<string, unknown>, b: Record<string, unknown>) => new Date((b.updated_at as string) ?? 0).getTime() - new Date((a.updated_at as string) ?? 0).getTime());
    return { podcasts: combined };
  });

  app.get('/api/podcasts/user/:userId', {
    preHandler: [requireAdmin],
    schema: {
      tags: ['Podcasts'],
      summary: 'List podcasts by user (admin)',
      description: 'List shows for a given user. Admin only.',
      params: { type: 'object', properties: { userId: { type: 'string' } }, required: ['userId'] },
      response: { 200: { description: 'List of podcasts' } },
    },
  }, async (request) => {
    const { userId } = request.params as { userId: string };
    const rows = db
      .prepare(`${podcastListSelect} WHERE owner_user_id = ? ORDER BY updated_at DESC`)
      .all(userId) as Record<string, unknown>[];
    return { podcasts: rows.map(podcastRowWithFilename) };
  });

  app.post('/api/podcasts', {
    preHandler: [requireAuth, requireNotReadOnly],
    schema: {
      tags: ['Podcasts'],
      summary: 'Create podcast',
      description: 'Create a new show. Requires read-write access.',
      body: { type: 'object', properties: { title: { type: 'string' }, slug: { type: 'string' }, description: { type: 'string' } }, required: ['title', 'slug'] },
      response: { 201: { description: 'Created podcast' }, 400: { description: 'Validation failed' }, 403: { description: 'At limit or read-only' }, 409: { description: 'Slug taken' } },
    },
  }, async (request, reply) => {
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

  app.get('/api/podcasts/:id', {
    preHandler: [requireAuth],
    schema: {
      tags: ['Podcasts'],
      summary: 'Get podcast',
      description: 'Get a show by ID. Must have access (owner or shared).',
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      response: { 200: { description: 'Podcast' }, 404: { description: 'Not found' } },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { userId } = request;
    if (getPodcastRole(userId, id) === null) {
      return reply.status(404).send({ error: 'Podcast not found' });
    }
    const row = db
      .prepare(
        `SELECT podcasts.id, podcasts.owner_user_id, podcasts.title, podcasts.slug, podcasts.description,
         podcasts.language, podcasts.author_name, podcasts.owner_name, podcasts.email,
         podcasts.category_primary, podcasts.category_secondary, podcasts.category_tertiary,
         podcasts.explicit, podcasts.artwork_path, podcasts.artwork_url, podcasts.site_url,
         podcasts.copyright, podcasts.podcast_guid, podcasts.locked, podcasts.license,
         podcasts.itunes_type, podcasts.medium, podcasts.created_at, podcasts.updated_at,
         podcasts.max_collaborators,
         COALESCE(podcasts.max_episodes, (SELECT max_episodes FROM users WHERE id = podcasts.owner_user_id)) AS max_episodes,
         (SELECT COUNT(*) FROM episodes WHERE podcast_id = podcasts.id) AS episode_count
         FROM podcasts WHERE podcasts.id = ?`
      )
      .get(id) as Record<string, unknown> | undefined;
    if (!row) return reply.status(404).send({ error: 'Podcast not found' });
    const role = getPodcastRole(userId, id);
    const isShared = role !== 'owner';
    const ownerId = row.owner_user_id as string;
    const can_record_new_section = ownerId ? !wouldExceedStorageLimit(db, ownerId, RECORD_MIN_FREE_BYTES) : true;
    const podcastMaxCollab = row.max_collaborators as number | null | undefined;
    const ownerMaxCollab = ownerId
      ? (db.prepare('SELECT max_collaborators FROM users WHERE id = ?').get(ownerId) as { max_collaborators: number | null } | undefined)?.max_collaborators ?? null
      : null;
    const effective_max_collaborators = podcastMaxCollab ?? ownerMaxCollab ?? null;
    return {
      ...podcastRowWithFilename(row),
      my_role: role ?? 'view',
      is_shared: isShared,
      can_record_new_section,
      effective_max_collaborators: effective_max_collaborators,
    };
  });

  app.get('/api/podcasts/:id/analytics', {
    preHandler: [requireAuth],
    schema: {
      tags: ['Podcasts'],
      summary: 'Get podcast analytics',
      description: 'Returns listen and episode analytics for a show.',
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      response: { 200: { description: 'Analytics data' }, 404: { description: 'Not found' } },
    },
  }, async (request, reply) => {
    const { id: podcastId } = request.params as { id: string };
    const { userId } = request;
    if (!canAccessPodcast(userId, podcastId)) {
      return reply.status(404).send({ error: 'Podcast not found' });
    }
    const podcast = db
      .prepare(
        `SELECT p.id, COALESCE(u.read_only, 0) AS owner_read_only
         FROM podcasts p
         INNER JOIN users u ON p.owner_user_id = u.id
         WHERE p.id = ?`
      )
      .get(podcastId) as { id: string; owner_read_only: number } | undefined;
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

    // If podcast owner is read-only, redact location names to "Location 1", "Location 2", etc.
    if (podcast.owner_read_only === 1 && episode_location_daily.length > 0) {
      const distinctLocations = [...new Set(episode_location_daily.map((r) => r.location))].sort();
      const locationToRedacted = new Map<string, string>();
      distinctLocations.forEach((loc, i) => locationToRedacted.set(loc, `Location ${i + 1}`));
      for (const row of episode_location_daily) {
        row.location = locationToRedacted.get(row.location) ?? row.location;
      }
    }

    return {
      rss_daily,
      episodes,
      episode_daily,
      episode_location_daily,
      episode_listens_daily,
    };
  });

  app.patch('/api/podcasts/:id', {
    preHandler: [requireAuth, requireNotReadOnly],
    schema: {
      tags: ['Podcasts'],
      summary: 'Update podcast',
      description: 'Update show metadata. Requires manager or owner.',
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      body: { type: 'object', properties: { title: { type: 'string' }, slug: { type: 'string' }, description: { type: 'string' } } },
      response: { 200: { description: 'Updated podcast' }, 400: { description: 'Validation failed' }, 403: { description: 'Only admins can edit slugs' }, 404: { description: 'Not found' }, 409: { description: 'Slug taken' } },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = podcastUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
    }
    const role = getPodcastRole(request.userId, id);
    if (!canEditEpisodeOrPodcastMetadata(role)) {
      return reply.status(404).send({ error: 'Podcast not found' });
    }
    
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
    if (data.max_collaborators !== undefined) {
      fields.push('max_collaborators = ?');
      values.push(data.max_collaborators);
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

  app.post('/api/podcasts/:id/artwork', {
    preHandler: [requireAuth, requireNotReadOnly],
    schema: {
      tags: ['Podcasts'],
      summary: 'Upload podcast artwork',
      description: 'Upload cover image (multipart). Max 5MB. Requires read-write access.',
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      response: { 200: { description: 'Artwork uploaded' }, 400: { description: 'No file or not image' }, 404: { description: 'Not found' } },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const role = getPodcastRole(request.userId, id);
    if (!canEditEpisodeOrPodcastMetadata(role)) {
      return reply.status(404).send({ error: 'Podcast not found' });
    }
    const existing = db.prepare('SELECT id, artwork_path FROM podcasts WHERE id = ?').get(id) as { id: string; artwork_path: string | null } | undefined;
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
    if (buffer.length > ARTWORK_MAX_BYTES) return reply.status(400).send({ error: `Image too large (max ${ARTWORK_MAX_MB}MB)` });
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

  // Collaborators (sharing)
  app.get('/api/podcasts/:podcastId/collaborators', {
    preHandler: [requireAuth],
    schema: {
      tags: ['Podcasts'],
      summary: 'List collaborators',
      description: 'List users with access to the podcast (manager or owner only).',
      params: { type: 'object', properties: { podcastId: { type: 'string' } }, required: ['podcastId'] },
      response: { 200: { description: 'List of collaborators' }, 404: { description: 'Not found' } },
    },
  }, async (request, reply) => {
    const { podcastId } = request.params as { podcastId: string };
    const role = getPodcastRole(request.userId, podcastId);
    if (!canManageCollaborators(role)) return reply.status(404).send({ error: 'Podcast not found' });
    const rows = db
      .prepare(
        `SELECT ps.user_id, ps.role, ps.created_at, u.email
         FROM podcast_shares ps
         JOIN users u ON u.id = ps.user_id
         WHERE ps.podcast_id = ?
         ORDER BY ps.created_at ASC`
      )
      .all(podcastId) as Array<{ user_id: string; role: string; created_at: string; email: string }>;
    return { collaborators: rows };
  });

  app.post('/api/podcasts/:podcastId/collaborators', {
    preHandler: [requireAuth, requireNotReadOnly],
    schema: {
      tags: ['Podcasts'],
      summary: 'Add collaborator',
      description: 'Invite a user by email. Returns USER_NOT_FOUND if email has no account.',
      params: { type: 'object', properties: { podcastId: { type: 'string' } }, required: ['podcastId'] },
      body: { type: 'object', properties: { email: { type: 'string' }, role: { type: 'string' } }, required: ['email', 'role'] },
      response: { 201: { description: 'Collaborator added' }, 400: { description: 'Invalid role' }, 403: { description: 'Collaborator limit' }, 404: { description: 'User not found' }, 500: { description: 'Server error' } },
    },
  }, async (request, reply) => {
    const { podcastId } = request.params as { podcastId: string };
    const role = getPodcastRole(request.userId, podcastId);
    if (!canManageCollaborators(role)) return reply.status(404).send({ error: 'Podcast not found' });
    const body = request.body as { email?: string; role?: string };
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    const shareRole = typeof body?.role === 'string' ? body.role.trim().toLowerCase() : '';
    if (!email) return reply.status(400).send({ error: 'email is required' });
    if (!KNOWN_ROLES.has(shareRole)) return reply.status(400).send({ error: 'Invalid role. Use view, editor, or manager.' });
    const user = db.prepare('SELECT id FROM users WHERE LOWER(email) = ?').get(email) as { id: string } | undefined;
    if (!user) {
      return reply.status(404).send({
        error: 'user_not_found',
        code: 'USER_NOT_FOUND',
        email,
        can_invite_to_platform: true,
      });
    }
    const podcast = db.prepare('SELECT owner_user_id, max_collaborators FROM podcasts WHERE id = ?').get(podcastId) as { owner_user_id: string; max_collaborators: number | null } | undefined;
    if (!podcast) return reply.status(404).send({ error: 'Podcast not found' });
    const ownerLimits = db.prepare('SELECT max_collaborators FROM users WHERE id = ?').get(podcast.owner_user_id) as { max_collaborators: number | null } | undefined;
    const maxCollaborators = podcast.max_collaborators ?? ownerLimits?.max_collaborators ?? null;
    if (maxCollaborators != null && maxCollaborators > 0) {
      const count = db.prepare('SELECT COUNT(*) as count FROM podcast_shares WHERE podcast_id = ?').get(podcastId) as { count: number };
      if (count.count >= maxCollaborators) {
        return reply.status(403).send({ error: 'This show has reached its collaborator limit.' });
      }
    }
    if (user.id === podcast.owner_user_id) {
      return reply.status(400).send({ error: 'The owner is already on the show.' });
    }
    try {
      db.prepare(
        'INSERT INTO podcast_shares (podcast_id, user_id, role) VALUES (?, ?, ?) ON CONFLICT(podcast_id, user_id) DO UPDATE SET role = excluded.role'
      ).run(podcastId, user.id, shareRole);
    } catch {
      return reply.status(500).send({ error: 'Failed to add collaborator' });
    }
    const row = db
      .prepare(
        `SELECT ps.user_id, ps.role, ps.created_at, u.email FROM podcast_shares ps JOIN users u ON u.id = ps.user_id WHERE ps.podcast_id = ? AND ps.user_id = ?`
      )
      .get(podcastId, user.id) as { user_id: string; role: string; created_at: string; email: string };
    return reply.status(201).send(row);
  });

  app.patch('/api/podcasts/:podcastId/collaborators/:userId', {
    preHandler: [requireAuth, requireNotReadOnly],
    schema: {
      tags: ['Podcasts'],
      summary: 'Update collaborator role',
      params: { type: 'object', properties: { podcastId: { type: 'string' }, userId: { type: 'string' } }, required: ['podcastId', 'userId'] },
      body: { type: 'object', properties: { role: { type: 'string' } }, required: ['role'] },
      response: { 200: { description: 'Updated' }, 400: { description: 'Invalid role' }, 404: { description: 'Not found' } },
    },
  }, async (request, reply) => {
    const { podcastId, userId: targetUserId } = request.params as { podcastId: string; userId: string };
    const role = getPodcastRole(request.userId, podcastId);
    if (!canManageCollaborators(role)) return reply.status(404).send({ error: 'Podcast not found' });
    const body = request.body as { role?: string };
    const shareRole = typeof body?.role === 'string' ? body.role.trim().toLowerCase() : '';
    if (!KNOWN_ROLES.has(shareRole)) return reply.status(400).send({ error: 'Invalid role. Use view, editor, or manager.' });
    const existing = db.prepare('SELECT user_id FROM podcast_shares WHERE podcast_id = ? AND user_id = ?').get(podcastId, targetUserId);
    if (!existing) return reply.status(404).send({ error: 'Collaborator not found' });
    db.prepare('UPDATE podcast_shares SET role = ? WHERE podcast_id = ? AND user_id = ?').run(shareRole, podcastId, targetUserId);
    const row = db
      .prepare(
        `SELECT ps.user_id, ps.role, ps.created_at, u.email FROM podcast_shares ps JOIN users u ON u.id = ps.user_id WHERE ps.podcast_id = ? AND ps.user_id = ?`
      )
      .get(podcastId, targetUserId) as { user_id: string; role: string; created_at: string; email: string };
    return row;
  });

  app.delete('/api/podcasts/:podcastId/collaborators/:userId', {
    preHandler: [requireAuth, requireNotReadOnly],
    schema: {
      tags: ['Podcasts'],
      summary: 'Remove collaborator',
      description: 'Remove access. Caller can be manager/owner or the user themselves (leave).',
      params: { type: 'object', properties: { podcastId: { type: 'string' }, userId: { type: 'string' } }, required: ['podcastId', 'userId'] },
      response: { 204: { description: 'Removed' }, 404: { description: 'Not found' } },
    },
  }, async (request, reply) => {
    const { podcastId, userId: targetUserId } = request.params as { podcastId: string; userId: string };
    const role = getPodcastRole(request.userId, podcastId);
    const isSelf = request.userId === targetUserId;
    if (!canManageCollaborators(role) && !isSelf) return reply.status(404).send({ error: 'Podcast not found' });
    const existing = db.prepare('SELECT user_id FROM podcast_shares WHERE podcast_id = ? AND user_id = ?').get(podcastId, targetUserId);
    if (!existing) return reply.status(404).send({ error: 'Collaborator not found' });
    db.prepare('DELETE FROM podcast_shares WHERE podcast_id = ? AND user_id = ?').run(podcastId, targetUserId);
    return reply.status(204).send();
  });
}
