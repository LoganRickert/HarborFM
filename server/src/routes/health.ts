import type { FastifyInstance } from 'fastify';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/api/health', async (_request, reply) => {
    return reply.send({ ok: true, timestamp: new Date().toISOString() });
  });
}
