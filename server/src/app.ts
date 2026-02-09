import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'fs';
import { randomBytes } from 'crypto';
import './db/migrate.js';
import { authPlugin } from './plugins/auth.js';
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { podcastRoutes } from './routes/podcasts.js';
import { episodeRoutes } from './routes/episodes.js';
import { audioRoutes } from './routes/audio.js';
import { libraryRoutes } from './routes/library.js';
import { segmentRoutes } from './routes/segments.js';
import { rssRoutes } from './routes/rss.js';
import { exportRoutes } from './routes/exports.js';
import { settingsRoutes } from './routes/settings.js';
import { llmRoutes } from './routes/llm.js';
import { usersRoutes } from './routes/users.js';
import { publicRoutes } from './routes/public.js';
import { setupRoutes } from './routes/setup.js';
import { ensureSecretsDir, getSecretsDir } from './services/paths.js';
import { getOrCreateSetupToken, isSetupComplete } from './services/setup.js';
import { getSecretsKey } from './services/secrets.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3001;

function loadOrCreateJwtSecret(): string {
  const fromEnv = process.env.JWT_SECRET?.trim();
  if (fromEnv) return fromEnv;

  ensureSecretsDir();
  const secretPath = join(getSecretsDir(), 'jwt-secret.txt');
  if (existsSync(secretPath)) {
    console.warn(
      `[security] JWT_SECRET is not set in the environment. ` +
        `Using the persisted secret at ${secretPath}. ` +
        `Set JWT_SECRET via env (Docker/PM2) for explicit, manageable deployments.`
    );
    const existing = readFileSync(secretPath, 'utf8').trim();
    // If the file exists but is empty/too short, treat it as invalid and regenerate.
    if (existing.length >= 32) return existing;
  }

  const secret = randomBytes(48).toString('base64url'); // 384-bit secret, URL-safe
  writeFileSync(secretPath, `${secret}\n`, { mode: 0o600 });
  try {
    chmodSync(secretPath, 0o600);
  } catch {
    // Best-effort: chmod may fail on some FS / platforms.
  }

  console.warn(
    `[security] JWT_SECRET is not set in the environment; generated and persisted a secret. ` +
      `Persist SECRETS_DIR to keep sessions stable across restarts, or (recommended) set JWT_SECRET via env.`
  );
  return secret;
}

const JWT_SECRET = loadOrCreateJwtSecret();

async function main() {
  const app = Fastify({ logger: true });

  // Validate/init secrets key at startup so missing ENV is visible in logs.
  // (Otherwise we'd only touch it when creating/testing/deploying exports.)
  getSecretsKey();

  // One-time setup phase
  if (!isSetupComplete()) {
    const token = getOrCreateSetupToken();
    const path = `/setup?id=${token}`;
    const line = '='.repeat(74);
    console.error(
      `\n${line}\n` +
        `HARBORFM SETUP REQUIRED\n\n` +
        `Open this URL to initialize the server (runs once):\n\n` +
        `  ${path}\n\n` +
        `${line}\n`
    );
  }

  await app.register(cors, {
    origin: process.env.NODE_ENV === 'production' ? false : true,
    credentials: true,
  });

  await app.register(rateLimit, {
    max: 50,
    timeWindow: '1 minute',
    allowList: (req) => {
      const path = req.url.split('?')[0];
      return (
        path === '/api/health' ||
        path.startsWith('/api/setup') ||
        path === '/setup'
      );
    },
  });

  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: 500 * 1024 * 1024 } });
  await app.register(jwt, {
    secret: JWT_SECRET,
    cookie: { cookieName: 'harborfm_jwt', signed: false },
  });
  await app.register(authPlugin);

  await app.register(healthRoutes);
  await app.register(authRoutes, { prefix: '/' });
  await app.register(podcastRoutes, { prefix: '/' });
  await app.register(episodeRoutes, { prefix: '/' });
  await app.register(audioRoutes, { prefix: '/' });
  await app.register(libraryRoutes, { prefix: '/' });
  await app.register(segmentRoutes, { prefix: '/' });
  await app.register(rssRoutes, { prefix: '/' });
  await app.register(exportRoutes, { prefix: '/' });
  await app.register(settingsRoutes, { prefix: '/' });
  await app.register(llmRoutes, { prefix: '/' });
  await app.register(usersRoutes, { prefix: '/' });
  await app.register(setupRoutes, { prefix: '/' });
  await app.register(publicRoutes, { prefix: '/' });

  // In production, serve the web app from PUBLIC_DIR (e.g. Docker copies web dist here)
  const publicDir = process.env.PUBLIC_DIR ?? join(__dirname, '..', 'public');
  if (existsSync(publicDir)) {
    await app.register(fastifyStatic, {
      root: publicDir,
      prefix: '/',
    });
    // SPA fallback: serve index.html for non-API routes that don't match a file (sendFile is added by @fastify/static)
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) {
        return reply.status(404).send({ error: 'Not found' });
      }
      return reply.sendFile('index.html');
    });
  }

  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`Server listening on http://0.0.0.0:${PORT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
