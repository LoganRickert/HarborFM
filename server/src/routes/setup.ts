import type { FastifyInstance } from 'fastify';
import argon2 from 'argon2';
import { nanoid } from 'nanoid';
import { db } from '../db/index.js';
import { consumeSetupToken, getOrCreateSetupToken, isSetupComplete, readSetupToken } from '../services/setup.js';
import { readSettings } from './settings.js';
import { getClientIp, getIpBan, getUserAgent, recordFailureAndMaybeBan } from '../services/loginAttempts.js';
import { normalizeHostname } from '../utils/url.js';

function writeSetting(key: string, value: string): void {
  db.prepare(
    'INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime(\'now\'))'
  ).run(key, value);
}

export async function setupRoutes(app: FastifyInstance) {
  app.get('/api/setup/status', async () => {
    const setupRequired = !isSetupComplete();
    if (setupRequired) {
      return { setupRequired: true, registrationEnabled: false, publicFeedsEnabled: false };
    }
    try {
      const settings = readSettings();
      return {
        setupRequired: false,
        registrationEnabled: Boolean(settings.registration_enabled),
        publicFeedsEnabled: Boolean(settings.public_feeds_enabled),
      };
    } catch {
      // Best-effort: if settings can't be read for any reason, default to allowing registration.
      return { setupRequired: false, registrationEnabled: true, publicFeedsEnabled: true };
    }
  });

  // Validate a setup link id (does NOT return the token).
  // Also participates in setup IP banning (too many invalid IDs).
  app.get('/api/setup/validate', async (request, reply) => {
    if (isSetupComplete()) {
      return reply.status(409).send({ error: 'Setup already completed' });
    }

    const ip = getClientIp(request);
    const userAgent = getUserAgent(request);
    const ban = getIpBan(ip, 'setup');
    if (ban.banned) {
      return reply
        .status(429)
        .header('Retry-After', String(ban.retryAfterSec))
        .send({ error: 'Too many invalid setup link attempts. Try again in a few minutes.' });
    }

    const query = request.query as { id?: string } | undefined;
    const token = typeof query?.id === 'string' ? query.id.trim() : '';
    if (!token) {
      return reply.status(400).send({ error: 'Missing setup id' });
    }

    const currentToken = readSetupToken();
    if (!currentToken || token !== currentToken) {
      const after = recordFailureAndMaybeBan(ip, 'setup', { userAgent });
      if (after.bannedNow) {
        return reply
          .status(429)
          .header('Retry-After', String(after.retryAfterSec))
          .send({ error: 'Too many invalid setup link attempts. Try again in a few minutes.' });
      }
      return reply.status(401).send({ error: 'Invalid setup id' });
    }

    return reply.send({ ok: true });
  });

  // Convenience endpoint so startup logs can mention a stable token exists (does NOT return the token).
  // Also ensures token is generated/persisted for the admin to use.
  app.post('/api/setup/prepare', async (request, reply) => {
    if (isSetupComplete()) return reply.status(409).send({ error: 'Setup already completed' });
    getOrCreateSetupToken();
    return { ok: true };
  });

  app.post('/api/setup/complete', async (request, reply) => {
    if (isSetupComplete()) {
      return reply.status(409).send({ error: 'Setup already completed' });
    }

    const ip = getClientIp(request);
    const userAgent = getUserAgent(request);
    const ban = getIpBan(ip, 'setup');
    if (ban.banned) {
      return reply
        .status(429)
        .header('Retry-After', String(ban.retryAfterSec))
        .send({ error: 'Too many invalid setup link attempts. Try again in a few minutes.' });
    }

    const query = request.query as { id?: string } | undefined;
    const token = typeof query?.id === 'string' ? query.id.trim() : '';
    if (!token) {
      return reply.status(401).send({ error: 'Missing setup id. Check server logs for the setup URL.' });
    }

    const body = request.body as
      | { email?: string; password?: string; hostname?: string; registration_enabled?: boolean; public_feeds_enabled?: boolean }
      | undefined;
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body?.password === 'string' ? body.password : '';
    const hostname = typeof body?.hostname === 'string' ? normalizeHostname(body.hostname) : '';
    const registrationEnabled = typeof body?.registration_enabled === 'boolean' ? body.registration_enabled : false;
    const publicFeedsEnabled = typeof body?.public_feeds_enabled === 'boolean' ? body.public_feeds_enabled : true;

    if (!email || !email.includes('@')) {
      return reply.status(400).send({ error: 'Valid email is required' });
    }
    if (!password || password.trim().length < 8) {
      return reply.status(400).send({ error: 'Password must be at least 8 characters' });
    }

    // Validate token before doing any writes (do not consume yet)
    const currentToken = readSetupToken();
    if (!currentToken || token !== currentToken) {
      // Record failed setup token attempt unless banned (checked above).
      const after = recordFailureAndMaybeBan(ip, 'setup', { userAgent });
      if (after.bannedNow) {
        return reply
          .status(429)
          .header('Retry-After', String(after.retryAfterSec))
          .send({ error: 'Too many invalid setup link attempts. Try again in a few minutes.' });
      }
      return reply.status(401).send({ error: 'Invalid setup id. Check server logs for the setup URL.' });
    }

    // Create initial admin user
    const id = nanoid();
    const password_hash = await argon2.hash(password);
    db.prepare('INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, ?)').run(
      id,
      email,
      password_hash,
      'admin'
    );

    // Persist initial settings
    writeSetting('hostname', hostname);
    writeSetting('registration_enabled', String(registrationEnabled));
    writeSetting('public_feeds_enabled', String(publicFeedsEnabled));
    writeSetting('setup_completed', 'true');

    // Consume token last so transient failures don't burn the setup URL.
    consumeSetupToken(token);

    return reply.status(201).send({ ok: true, user: { id, email, role: 'admin' as const } });
  });
}

