import type { FastifyInstance, FastifyRequest } from 'fastify';
import { db } from '../db/index.js';
import { readSettings } from './settings.js';
import { assertSafeId } from '../services/paths.js';
import {
  generateSitemapIndex,
  generateStaticSitemapXml,
  generatePodcastSitemapXml,
  getCachedSitemapIfFresh,
  getCachedSitemapIndexIfFresh,
  writeSitemapToFile,
  writeSitemapIndexToFile,
} from '../services/sitemap.js';
import { RSS_CACHE_MAX_AGE_MS } from '../config.js';

function getBaseUrl(request: FastifyRequest): string {
  const settings = readSettings();
  const hostname = (settings.hostname ?? '').trim();
  if (hostname) {
    const url = hostname.startsWith('http') ? hostname : `https://${hostname}`;
    return url.replace(/\/+$/, '');
  }
  const proto = request.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
  const host = (request.headers['x-forwarded-host'] as string) || request.hostname || 'localhost';
  return `${proto}://${host}`;
}

/** Only allow slug characters that are safe for path and URL (no path traversal). */
const SAFE_SLUG = /^[a-zA-Z0-9_-]+$/;

function assertSafeSlug(slug: string): void {
  if (!SAFE_SLUG.test(slug)) {
    throw new Error('Invalid slug: disallowed characters');
  }
}

export async function sitemapRoutes(app: FastifyInstance) {
  // Sitemap index: cached like podcast sitemaps (1h). Lists static sitemap + one per podcast (when public feeds enabled). Includes lastmod.
  app.get('/api/sitemap.xml', {
    schema: {
      tags: ['Sitemap'],
      summary: 'Sitemap index',
      description: 'Returns sitemap index XML. Public, no auth.',
      security: [],
      response: { 200: { description: 'Sitemap index XML' } },
    },
  }, async (request, reply) => {
    const cached = getCachedSitemapIndexIfFresh(RSS_CACHE_MAX_AGE_MS);
    if (cached) {
      return reply
        .header('Content-Type', 'application/xml; charset=utf-8')
        .header('Cache-Control', 'public, max-age=3600')
        .send(cached);
    }
    const baseUrl = getBaseUrl(request);
    const settings = readSettings();
    const lastmod = new Date().toISOString().slice(0, 10);
    const entries: { loc: string; lastmod: string }[] = [
      { loc: `${baseUrl}/api/sitemap/static.xml`, lastmod },
    ];
    if (settings.public_feeds_enabled) {
      const rows = db.prepare('SELECT id, slug FROM podcasts ORDER BY created_at ASC').all() as {
        id: string;
        slug: string;
      }[];
      for (const row of rows) {
        if (SAFE_SLUG.test(row.slug)) {
          entries.push({
            loc: `${baseUrl}/api/sitemap/podcast/${encodeURIComponent(row.slug)}.xml`,
            lastmod,
          });
        }
      }
    }
    const xml = generateSitemapIndex(entries);
    writeSitemapIndexToFile(xml);
    return reply
      .header('Content-Type', 'application/xml; charset=utf-8')
      .header('Cache-Control', 'public, max-age=3600')
      .send(xml);
  });

  // Static sitemap: root, login, register, privacy, terms (feed pages are in per-podcast sitemaps).
  app.get('/api/sitemap/static.xml', {
    schema: {
      tags: ['Sitemap'],
      summary: 'Static sitemap',
      description: 'Returns static pages sitemap XML. Public, no auth.',
      security: [],
      response: { 200: { description: 'Sitemap XML' } },
    },
  }, async (request, reply) => {
    const baseUrl = getBaseUrl(request);
    const xml = generateStaticSitemapXml(baseUrl);
    return reply
      .header('Content-Type', 'application/xml; charset=utf-8')
      .header('Cache-Control', 'public, max-age=3600')
      .send(xml);
  });

  // Per-podcast sitemap: cached like RSS — if missing or older than 1 hour, regenerate; else serve from disk. Paths asserted in service.
  app.get('/api/sitemap/podcast/:slug.xml', {
    schema: {
      tags: ['Sitemap'],
      summary: 'Podcast sitemap',
      description: 'Returns sitemap XML for a podcast feed. Public when public feeds enabled.',
      security: [],
      params: { type: 'object', properties: { slug: { type: 'string' } }, required: ['slug'] },
      response: { 200: { description: 'Sitemap XML' }, 404: { description: 'Not found' }, 500: { description: 'Failed to generate sitemap' } },
    },
  }, async (request, reply) => {
    const settings = readSettings();
    if (!settings.public_feeds_enabled) {
      return reply.status(404).send({ error: 'Not found' });
    }
    const { slug } = request.params as { slug: string };
    try {
      assertSafeSlug(slug);
    } catch {
      return reply.status(404).send({ error: 'Not found' });
    }
    const podcast = db
      .prepare('SELECT id FROM podcasts WHERE slug = ?')
      .get(slug) as { id: string } | undefined;
    if (!podcast) return reply.status(404).send({ error: 'Not found' });
    try {
      assertSafeId(podcast.id, 'podcastId');
    } catch {
      return reply.status(404).send({ error: 'Not found' });
    }
    const baseUrl = getBaseUrl(request);
    try {
      const cached = getCachedSitemapIfFresh(podcast.id, RSS_CACHE_MAX_AGE_MS);
      if (cached) {
        return reply
          .header('Content-Type', 'application/xml; charset=utf-8')
          .header('Cache-Control', 'public, max-age=3600')
          .send(cached);
      }
      const xml = generatePodcastSitemapXml(podcast.id, baseUrl);
      writeSitemapToFile(podcast.id, xml);
      return reply
        .header('Content-Type', 'application/xml; charset=utf-8')
        .header('Cache-Control', 'public, max-age=3600')
        .send(xml);
    } catch (_err) {
      return reply.status(500).send({ error: 'Failed to generate sitemap' });
    }
  });
}
