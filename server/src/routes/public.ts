import type { FastifyInstance } from 'fastify';
import { db } from '../db/index.js';
import { generateRss } from '../services/rss.js';
import { readSettings } from './settings.js';

export async function publicRoutes(app: FastifyInstance) {
  function ensurePublicFeedsEnabled(reply: import('fastify').FastifyReply): boolean {
    const settings = readSettings();
    if (!settings.public_feeds_enabled) {
      // Hide the existence of feeds when disabled.
      reply.status(404).send({ error: 'Not found' });
      return false;
    }
    return true;
  }

  function publicPodcastDto(row: Record<string, unknown>) {
    return {
      id: row.id,
      title: row.title,
      slug: row.slug,
      description: row.description ?? '',
      language: row.language ?? 'en',
      author_name: row.author_name ?? '',
      artwork_url: row.artwork_url ?? null,
      site_url: row.site_url ?? null,
      explicit: row.explicit ?? 0,
    };
  }

  function publicEpisodeDto(podcastId: string, row: Record<string, unknown>) {
    const audioBytes = row.audio_bytes != null ? Number(row.audio_bytes) : null;
    const hasAudio = Boolean(row.audio_final_path) && (audioBytes == null || audioBytes > 0);
    return {
      id: row.id,
      podcast_id: row.podcast_id,
      title: row.title,
      slug: row.slug,
      description: row.description ?? '',
      guid: row.guid,
      season_number: row.season_number ?? null,
      episode_number: row.episode_number ?? null,
      episode_type: row.episode_type ?? null,
      explicit: row.explicit ?? null,
      publish_at: row.publish_at ?? null,
      artwork_url: row.artwork_url ?? null,
      audio_mime: row.audio_mime ?? null,
      audio_bytes: audioBytes,
      audio_duration_sec: row.audio_duration_sec ?? null,
      audio_url: hasAudio ? `/api/${podcastId}/episodes/${String(row.id)}` : null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  // Public config (no auth): used by the web client to gate /feed routes.
  app.get('/api/public/config', async (_request, reply) => {
    const settings = readSettings();
    return reply.send({ public_feeds_enabled: Boolean(settings.public_feeds_enabled) });
  });

  // Get podcast by slug (public, no auth required)
  app.get('/api/public/podcasts/:slug', async (request, reply) => {
    if (!ensurePublicFeedsEnabled(reply)) return;
    const { slug } = request.params as { slug: string };
    const row = db
      .prepare(
        `SELECT id, title, slug, description, language, author_name, artwork_url, site_url, explicit
         FROM podcasts WHERE slug = ?`
      )
      .get(slug) as Record<string, unknown> | undefined;
    if (!row) return reply.status(404).send({ error: 'Podcast not found' });
    const dto = publicPodcastDto(row) as Record<string, unknown>;
    const exportRow = db
      .prepare(
        `SELECT public_base_url, prefix FROM exports WHERE podcast_id = ? AND public_base_url IS NOT NULL AND LENGTH(TRIM(public_base_url)) > 0 LIMIT 1`
      )
      .get(row.id) as { public_base_url: string; prefix: string | null } | undefined;
    if (exportRow?.public_base_url) {
      const base = String(exportRow.public_base_url).trim().replace(/\/$/, '');
      const prefix = exportRow.prefix != null ? String(exportRow.prefix).trim().replace(/^\/|\/$/g, '') : '';
      dto.rss_url = prefix ? `${base}/${prefix}/feed.xml` : `${base}/feed.xml`;
    }
    return dto;
  });

  // Get published episodes for a podcast by podcast slug (public, no auth required)
  app.get('/api/public/podcasts/:podcastSlug/episodes', async (request, reply) => {
    if (!ensurePublicFeedsEnabled(reply)) return;
    const { podcastSlug } = request.params as { podcastSlug: string };
    const query = request.query as { limit?: string; offset?: string };
    const limit = Math.min(parseInt(query.limit || '50', 10) || 50, 100); // Default 50, max 100
    const offset = Math.max(parseInt(query.offset || '0', 10) || 0, 0);
    
    const podcast = db
      .prepare('SELECT id FROM podcasts WHERE slug = ?')
      .get(podcastSlug) as { id: string } | undefined;
    if (!podcast) return reply.status(404).send({ error: 'Podcast not found' });
    
    // Get total count
    const totalCount = db
      .prepare(
        `SELECT COUNT(*) as count FROM episodes 
         WHERE podcast_id = ? AND status = 'published'
         AND (publish_at IS NULL OR datetime(publish_at) <= datetime('now'))`
      )
      .get(podcast.id) as { count: number };
    
    // Get paginated episodes
    const rows = db
      .prepare(
        `SELECT id, podcast_id, title, slug, description, guid,
                season_number, episode_number, episode_type, explicit, publish_at,
                artwork_url, audio_mime, audio_bytes, audio_duration_sec, audio_final_path,
                created_at, updated_at
         FROM episodes 
         WHERE podcast_id = ? AND status = 'published'
         AND (publish_at IS NULL OR datetime(publish_at) <= datetime('now'))
         ORDER BY publish_at DESC, created_at DESC
         LIMIT ? OFFSET ?`
      )
      .all(podcast.id, limit, offset) as Record<string, unknown>[];
    
    return { 
      episodes: rows.map((r) => publicEpisodeDto(podcast.id, r)),
      total: totalCount.count,
      limit,
      offset,
      hasMore: offset + rows.length < totalCount.count
    };
  });

  // Get episode by podcast slug and episode slug (public, no auth required)
  app.get('/api/public/podcasts/:podcastSlug/episodes/:episodeSlug', async (request, reply) => {
    if (!ensurePublicFeedsEnabled(reply)) return;
    const { podcastSlug, episodeSlug } = request.params as { podcastSlug: string; episodeSlug: string };
    const podcast = db
      .prepare('SELECT id FROM podcasts WHERE slug = ?')
      .get(podcastSlug) as { id: string } | undefined;
    if (!podcast) return reply.status(404).send({ error: 'Podcast not found' });
    
    const row = db
      .prepare(
        `SELECT id, podcast_id, title, slug, description, guid,
                season_number, episode_number, episode_type, explicit, publish_at,
                artwork_url, audio_mime, audio_bytes, audio_duration_sec, audio_final_path,
                created_at, updated_at
         FROM episodes 
         WHERE podcast_id = ? AND slug = ? AND status = 'published'
         AND (publish_at IS NULL OR datetime(publish_at) <= datetime('now'))`
      )
      .get(podcast.id, episodeSlug) as Record<string, unknown> | undefined;
    if (!row) return reply.status(404).send({ error: 'Episode not found' });
    return publicEpisodeDto(podcast.id, row);
  });

  // Get RSS feed by podcast slug (public, no auth required)
  app.get('/api/public/podcasts/:podcastSlug/rss', async (request, reply) => {
    if (!ensurePublicFeedsEnabled(reply)) return;
    const { podcastSlug } = request.params as { podcastSlug: string };
    const podcast = db
      .prepare('SELECT id FROM podcasts WHERE slug = ?')
      .get(podcastSlug) as { id: string } | undefined;
    if (!podcast) return reply.status(404).send({ error: 'Podcast not found' });
    
    try {
      const xml = generateRss(podcast.id, null);
      return reply
        .header('Content-Type', 'application/xml')
        .header('Cache-Control', 'public, max-age=3600')
        .send(xml);
    } catch (_err) {
      return reply.status(500).send({ error: 'Failed to generate RSS feed' });
    }
  });
}
