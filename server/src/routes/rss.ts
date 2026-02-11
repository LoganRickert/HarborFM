import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../plugins/auth.js';
import { generateRss, writeRssFile } from '../services/rss.js';
import { isAdmin, canAccessPodcast } from '../services/access.js';

export async function rssRoutes(app: FastifyInstance) {
  app.get(
    '/api/podcasts/:id/rss-preview',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['RSS'],
        summary: 'RSS preview',
        description: 'Generate RSS XML for a podcast (preview). Optional public_base_url in query.',
        params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
        querystring: { type: 'object', properties: { public_base_url: { type: 'string' } } },
        response: { 200: { description: 'RSS XML' }, 404: { description: 'Podcast not found' } },
      },
    },
    async (request, reply) => {
      const { id: podcastId } = request.params as { id: string };
      if (!canAccessPodcast(request.userId, podcastId) && !isAdmin(request.userId)) {
        return reply.status(404).send({ error: 'Podcast not found' });
      }
      const publicBaseUrl = (request.query as { public_base_url?: string })?.public_base_url ?? null;
      const xml = generateRss(podcastId, publicBaseUrl);
      return reply
        .header('Content-Type', 'application/rss+xml; charset=utf-8')
        .send(xml);
    }
  );

  app.post(
    '/api/podcasts/:id/generate-rss',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['RSS'],
        summary: 'Generate RSS file',
        description: 'Write RSS feed to disk for a podcast. Optional public_base_url in body.',
        params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
        body: { type: 'object', properties: { public_base_url: { type: 'string' } } },
        response: { 200: { description: 'Path and message' }, 404: { description: 'Podcast not found' } },
      },
    },
    async (request, reply) => {
      const { id: podcastId } = request.params as { id: string };
      if (!canAccessPodcast(request.userId, podcastId) && !isAdmin(request.userId)) {
        return reply.status(404).send({ error: 'Podcast not found' });
      }
      const publicBaseUrl = (request.body as { public_base_url?: string })?.public_base_url ?? null;
      const path = writeRssFile(podcastId, publicBaseUrl);
      return { path, message: 'RSS generated' };
    }
  );
}
