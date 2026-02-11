import type { FastifyInstance } from 'fastify';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Root package.json (monorepo root): from server/src/routes -> server -> root. */
function getRootVersion(): string | null {
  const rootPkg = join(__dirname, '..', '..', '..', 'package.json');
  if (!existsSync(rootPkg)) return null;
  try {
    const raw = readFileSync(rootPkg, 'utf-8');
    const pkg = JSON.parse(raw) as { version?: string };
    return typeof pkg.version === 'string' ? pkg.version : null;
  } catch {
    return null;
  }
}

export async function healthRoutes(app: FastifyInstance) {
  app.get('/api/health', {
    schema: {
      tags: ['Health'],
      summary: 'Health check',
      description: 'Returns server health status. No authentication required.',
      security: [],
      response: {
        200: {
          description: 'Server is healthy',
          type: 'object',
          properties: { ok: { type: 'boolean' }, timestamp: { type: 'string', format: 'date-time' } },
          required: ['ok', 'timestamp'],
        },
      },
    },
  }, async (_request, reply) => {
    return reply.send({ ok: true, timestamp: new Date().toISOString() });
  });

  app.get('/api/version', {
    schema: {
      tags: ['Health'],
      summary: 'Version',
      description: 'Returns the application version from the root package.json. No authentication required.',
      security: [],
      response: {
        200: {
          description: 'Version info',
          type: 'object',
          properties: { version: { type: 'string' } },
          required: ['version'],
        },
      },
    },
  }, async (_request, reply) => {
    const version = getRootVersion();
    return reply.send({ version: version ?? 'unknown' });
  });
}
