import type { FastifyInstance } from 'fastify';
import { createReadStream, existsSync, readFileSync } from 'fs';
import { basename, extname } from 'path';
import { db } from '../db/index.js';
import { getExportPathPrefix } from '../services/export-config.js';
import { getUserAgent } from '../services/loginAttempts.js';
import { recordRssRequest } from '../services/podcastStats.js';
import { assertPathUnder, assertSafeId, artworkDir, processedDir } from '../services/paths.js';
import { EXT_DOT_TO_MIMETYPE } from '../utils/artwork.js';
import { isHumanUserAgent } from '../utils/isBot.js';
import { generateRss, getCachedRssIfFresh, writeRssToFile } from '../services/rss.js';
import { readSettings } from './settings.js';

/** Max age (ms) for serving cached public RSS feed from disk before regenerating. From env RSS_CACHE_MAX_AGE_MS or 1 hour. */
const RSS_CACHE_MAX_AGE_MS = Number(process.env.RSS_CACHE_MAX_AGE_MS) || 60 * 60 * 1000;

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
    const path = row.artwork_path as string | null | undefined;
    return {
      id: row.id,
      title: row.title,
      slug: row.slug,
      description: row.description ?? '',
      language: row.language ?? 'en',
      author_name: row.author_name ?? '',
      artwork_url: row.artwork_url ?? null,
      artwork_uploaded: Boolean(path),
      artwork_filename: path ? basename(path) : null,
      site_url: row.site_url ?? null,
      explicit: row.explicit ?? 0,
    };
  }

  function publicEpisodeDto(podcastId: string, row: Record<string, unknown>) {
    const audioBytes = row.audio_bytes != null ? Number(row.audio_bytes) : null;
    const hasAudio = Boolean(row.audio_final_path) && (audioBytes == null || audioBytes > 0);
    const path = row.artwork_path as string | null | undefined;
    const baseDesc = String(row.description ?? '');
    const snapshot = row.description_copyright_snapshot != null ? String(row.description_copyright_snapshot).trim() : '';
    const description = snapshot ? `${baseDesc}\r\n\r\nMusic:\r\n${snapshot}` : baseDesc;
    return {
      id: row.id,
      podcast_id: row.podcast_id,
      title: row.title,
      slug: row.slug,
      description,
      guid: row.guid,
      season_number: row.season_number ?? null,
      episode_number: row.episode_number ?? null,
      episode_type: row.episode_type ?? null,
      explicit: row.explicit ?? null,
      publish_at: row.publish_at ?? null,
      artwork_url: row.artwork_url ?? null,
      artwork_filename: path ? basename(path) : null,
      audio_mime: row.audio_mime ?? null,
      audio_bytes: audioBytes,
      audio_duration_sec: row.audio_duration_sec ?? null,
      audio_url: hasAudio ? `/api/${podcastId}/episodes/${String(row.id)}` : null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  // Safe filename for artwork: nanoid.ext or episodeId.ext (alphanumeric, hyphen, underscore + .png|.webp|.jpg)
  const ARTWORK_FILENAME_REGEX = /^[a-zA-Z0-9_-]+\.(png|webp|jpg)$/i;

  // Serve uploaded episode cover image (public so feed and edit preview can use it).
  app.get('/api/public/artwork/:podcastId/episodes/:episodeId/:filename', {
    schema: {
      tags: ['Public'],
      summary: 'Get episode artwork',
      description: 'Returns the episode cover image (PNG/WebP/JPG). No authentication required.',
      security: [],
      params: { type: 'object', properties: { podcastId: { type: 'string' }, episodeId: { type: 'string' }, filename: { type: 'string' } }, required: ['podcastId', 'episodeId', 'filename'] },
      response: { 200: { description: 'Image binary' }, 404: { description: 'Not found' } },
    },
  }, async (request, reply) => {
    const { podcastId, episodeId, filename } = request.params as { podcastId: string; episodeId: string; filename: string };
    try {
      assertSafeId(podcastId, 'podcastId');
      assertSafeId(episodeId, 'episodeId');
    } catch {
      return reply.status(404).send({ error: 'Not found' });
    }
    if (!ARTWORK_FILENAME_REGEX.test(filename)) {
      return reply.status(404).send({ error: 'Not found' });
    }
    const row = db
      .prepare('SELECT artwork_path FROM episodes WHERE id = ? AND podcast_id = ?')
      .get(episodeId, podcastId) as { artwork_path: string | null } | undefined;
    if (!row?.artwork_path || basename(row.artwork_path) !== filename) {
      return reply.status(404).send({ error: 'Not found' });
    }
    try {
      const safePath = assertPathUnder(row.artwork_path, artworkDir(podcastId));
      const ext = extname(safePath).toLowerCase();
      const contentType = EXT_DOT_TO_MIMETYPE[ext] ?? 'image/jpeg';
      const stream = createReadStream(safePath);
      return reply
        .header('Content-Type', contentType)
        .header('Cache-Control', 'public, max-age=86400')
        .send(stream);
    } catch {
      return reply.status(404).send({ error: 'Not found' });
    }
  });

  // Serve uploaded podcast cover image (public so feed and edit preview can use it). URL includes filename so cache busts on new upload.
  app.get('/api/public/artwork/:podcastId/:filename', {
    schema: {
      tags: ['Public'],
      summary: 'Get podcast artwork',
      description: 'Returns the podcast/show cover image (PNG/WebP/JPG). No authentication required.',
      security: [],
      params: { type: 'object', properties: { podcastId: { type: 'string' }, filename: { type: 'string' } }, required: ['podcastId', 'filename'] },
      response: { 200: { description: 'Image binary' }, 404: { description: 'Not found' } },
    },
  }, async (request, reply) => {
    const { podcastId, filename } = request.params as { podcastId: string; filename: string };
    try {
      assertSafeId(podcastId, 'podcastId');
    } catch {
      return reply.status(404).send({ error: 'Not found' });
    }
    if (!ARTWORK_FILENAME_REGEX.test(filename)) {
      return reply.status(404).send({ error: 'Not found' });
    }
    const row = db
      .prepare('SELECT artwork_path FROM podcasts WHERE id = ?')
      .get(podcastId) as { artwork_path: string | null } | undefined;
    if (!row?.artwork_path || basename(row.artwork_path) !== filename) {
      return reply.status(404).send({ error: 'Not found' });
    }
    try {
      const safePath = assertPathUnder(row.artwork_path, artworkDir(podcastId));
      const ext = extname(safePath).toLowerCase();
      const contentType = EXT_DOT_TO_MIMETYPE[ext] ?? 'image/jpeg';
      const stream = createReadStream(safePath);
      return reply
        .header('Content-Type', contentType)
        .header('Cache-Control', 'public, max-age=86400')
        .send(stream);
    } catch {
      return reply.status(404).send({ error: 'Not found' });
    }
  });

  // Public config (no auth): used by the web client to gate /feed routes.
  app.get('/api/public/config', {
    schema: {
      tags: ['Public'],
      summary: 'Get public config',
      description: 'Returns whether public feeds are enabled. No authentication required.',
      security: [],
      response: { 200: { description: 'Config', type: 'object', properties: { public_feeds_enabled: { type: 'boolean' } }, required: ['public_feeds_enabled'] } },
    },
  }, async (_request, reply) => {
    const settings = readSettings();
    return reply.send({ public_feeds_enabled: Boolean(settings.public_feeds_enabled) });
  });

  // Get podcast by slug (public, no auth required)
  app.get('/api/public/podcasts/:slug', {
    schema: {
      tags: ['Public'],
      summary: 'Get podcast by slug',
      description: 'Returns podcast metadata by URL slug. No authentication required. 404 when public feeds are disabled.',
      security: [],
      params: { type: 'object', properties: { slug: { type: 'string' } }, required: ['slug'] },
      response: { 200: { description: 'Podcast metadata' }, 404: { description: 'Not found' } },
    },
  }, async (request, reply) => {
    if (!ensurePublicFeedsEnabled(reply)) return;
    const { slug } = request.params as { slug: string };
    const row = db
      .prepare(
        `SELECT id, title, slug, description, language, author_name, artwork_url, artwork_path, site_url, explicit
         FROM podcasts WHERE slug = ?`
      )
      .get(slug) as Record<string, unknown> | undefined;
    if (!row) return reply.status(404).send({ error: 'Podcast not found' });
    const dto = publicPodcastDto(row) as Record<string, unknown>;
    const exportRow = db
      .prepare(
        `SELECT id, podcast_id, mode, name, public_base_url, config_enc FROM exports WHERE podcast_id = ? AND public_base_url IS NOT NULL AND LENGTH(TRIM(public_base_url)) > 0 LIMIT 1`
      )
      .get(row.id) as Record<string, unknown> | undefined;
    if (exportRow?.public_base_url) {
      const base = String(exportRow.public_base_url).trim().replace(/\/$/, '');
      const prefix = getExportPathPrefix(exportRow) ?? '';
      dto.rss_url = prefix ? `${base}/${prefix}/feed.xml` : `${base}/feed.xml`;
    }
    return dto;
  });

  // Get published episodes for a podcast by podcast slug (public, no auth required)
  app.get('/api/public/podcasts/:podcastSlug/episodes', {
    schema: {
      tags: ['Public'],
      summary: 'List podcast episodes',
      description: 'Returns published episodes for a podcast (paginated). No authentication required.',
      security: [],
      params: { type: 'object', properties: { podcastSlug: { type: 'string' } }, required: ['podcastSlug'] },
      querystring: { type: 'object', properties: { limit: { type: 'string' }, offset: { type: 'string' } } },
      response: { 200: { description: 'Episodes list with total, limit, offset, hasMore' }, 404: { description: 'Podcast not found' } },
    },
  }, async (request, reply) => {
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
        `SELECT id, podcast_id, title, slug, description, description_copyright_snapshot, guid,
                season_number, episode_number, episode_type, explicit, publish_at,
                artwork_url, artwork_path, audio_mime, audio_bytes, audio_duration_sec, audio_final_path,
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
  app.get('/api/public/podcasts/:podcastSlug/episodes/:episodeSlug', {
    schema: {
      tags: ['Public'],
      summary: 'Get episode by slug',
      description: 'Returns a published episode by podcast and episode slug. No authentication required.',
      security: [],
      params: { type: 'object', properties: { podcastSlug: { type: 'string' }, episodeSlug: { type: 'string' } }, required: ['podcastSlug', 'episodeSlug'] },
      response: { 200: { description: 'Episode metadata' }, 404: { description: 'Not found' } },
    },
  }, async (request, reply) => {
    if (!ensurePublicFeedsEnabled(reply)) return;
    const { podcastSlug, episodeSlug } = request.params as { podcastSlug: string; episodeSlug: string };
    const podcast = db
      .prepare('SELECT id FROM podcasts WHERE slug = ?')
      .get(podcastSlug) as { id: string } | undefined;
    if (!podcast) return reply.status(404).send({ error: 'Podcast not found' });
    
    const row = db
      .prepare(
        `SELECT id, podcast_id, title, slug, description, description_copyright_snapshot, guid,
                season_number, episode_number, episode_type, explicit, publish_at,
                artwork_url, artwork_path, audio_mime, audio_bytes, audio_duration_sec, audio_final_path,
                created_at, updated_at
         FROM episodes 
         WHERE podcast_id = ? AND slug = ? AND status = 'published'
         AND (publish_at IS NULL OR datetime(publish_at) <= datetime('now'))`
      )
      .get(podcast.id, episodeSlug) as Record<string, unknown> | undefined;
    if (!row) return reply.status(404).send({ error: 'Episode not found' });
    return publicEpisodeDto(podcast.id, row);
  });

  // Get episode waveform by podcast slug and episode slug (public, no auth required)
  app.get('/api/public/podcasts/:podcastSlug/episodes/:episodeSlug/waveform', {
    schema: {
      tags: ['Public'],
      summary: 'Get episode waveform',
      description: 'Returns waveform JSON for a published episode. No authentication required.',
      security: [],
      params: { type: 'object', properties: { podcastSlug: { type: 'string' }, episodeSlug: { type: 'string' } }, required: ['podcastSlug', 'episodeSlug'] },
      response: { 200: { description: 'Waveform JSON' }, 404: { description: 'Not found' } },
    },
  }, async (request, reply) => {
    if (!ensurePublicFeedsEnabled(reply)) return;
    const { podcastSlug, episodeSlug } = request.params as { podcastSlug: string; episodeSlug: string };
    const podcast = db
      .prepare('SELECT id FROM podcasts WHERE slug = ?')
      .get(podcastSlug) as { id: string } | undefined;
    if (!podcast) return reply.status(404).send({ error: 'Podcast not found' });

    const row = db
      .prepare(
        `SELECT id, audio_final_path FROM episodes
         WHERE podcast_id = ? AND slug = ? AND status = 'published'
         AND (publish_at IS NULL OR datetime(publish_at) <= datetime('now'))`
      )
      .get(podcast.id, episodeSlug) as { id: string; audio_final_path: string | null } | undefined;
    if (!row || !row.audio_final_path || !existsSync(row.audio_final_path)) {
      return reply.status(404).send({ error: 'Waveform not found' });
    }
    const waveformPath = row.audio_final_path.replace(/\.[^.]+$/, '.waveform.json');
    if (!existsSync(waveformPath)) return reply.status(404).send({ error: 'Waveform not found' });
    try {
      assertPathUnder(waveformPath, processedDir(podcast.id, row.id));
    } catch {
      return reply.status(404).send({ error: 'Waveform not found' });
    }
    const json = readFileSync(waveformPath, 'utf-8');
    return reply
      .header('Content-Type', 'application/json')
      .header('Cache-Control', 'public, max-age=3600')
      .send(json);
  });

  // Get RSS feed by podcast slug (public, no auth required)
  // Serves from data/rss/:podcastId/feed.xml if present and < RSS_CACHE_MAX_AGE_MS; otherwise generates, saves, and serves.
  // HEAD requests are not counted. 304 Not Modified (if added) should still count as a feed check — record before sending.
  app.get('/api/public/podcasts/:podcastSlug/rss', {
    schema: {
      tags: ['Public'],
      summary: 'Get RSS feed',
      description: 'Returns the RSS feed XML for a podcast by slug. No authentication required.',
      security: [],
      params: { type: 'object', properties: { podcastSlug: { type: 'string' } }, required: ['podcastSlug'] },
      response: { 200: { description: 'RSS XML' }, 404: { description: 'Podcast not found' }, 500: { description: 'Failed to generate feed' } },
    },
  }, async (request, reply) => {
    if (!ensurePublicFeedsEnabled(reply)) return;
    const { podcastSlug } = request.params as { podcastSlug: string };
    const podcast = db
      .prepare('SELECT id FROM podcasts WHERE slug = ?')
      .get(podcastSlug) as { id: string } | undefined;
    if (!podcast) return reply.status(404).send({ error: 'Podcast not found' });

    if (request.method === 'GET') {
      const ua = getUserAgent(request);
      const isBot = !isHumanUserAgent(ua);
      recordRssRequest(podcast.id, isBot);
    }

    try {
      const cached = getCachedRssIfFresh(podcast.id, RSS_CACHE_MAX_AGE_MS);
      if (cached) {
        return reply
          .header('Content-Type', 'application/xml')
          .header('Cache-Control', 'public, max-age=3600')
          .send(cached);
      }
      const xml = generateRss(podcast.id, null);
      writeRssToFile(podcast.id, xml);
      return reply
        .header('Content-Type', 'application/xml')
        .header('Cache-Control', 'public, max-age=3600')
        .send(xml);
    } catch (_err) {
      return reply.status(500).send({ error: 'Failed to generate RSS feed' });
    }
  });
}
