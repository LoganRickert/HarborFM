import type { FastifyInstance } from 'fastify';
import { db } from '../db/index.js';
import { requireAuth } from '../plugins/auth.js';
import { generateRss, writeRssFile } from '../services/rss.js';

function canAccessPodcast(userId: string, podcastId: string): boolean {
  const row = db.prepare('SELECT id FROM podcasts WHERE id = ? AND owner_user_id = ?').get(podcastId, userId);
  return !!row;
}

function isAdmin(userId: string): boolean {
  const user = db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as { role: string } | undefined;
  return user?.role === 'admin';
}

export async function rssRoutes(app: FastifyInstance) {
  app.get(
    '/api/podcasts/:id/rss-preview',
    { preHandler: [requireAuth] },
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
    { preHandler: [requireAuth] },
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
