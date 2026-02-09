import type { FastifyInstance } from 'fastify';
import argon2 from 'argon2';
import { requireAuth } from '../plugins/auth.js';
import { nanoid } from 'nanoid';
import { db } from '../db/index.js';
import { registerBodySchema, loginBodySchema } from '@harborfm/shared';
import { readSettings } from './settings.js';
import { randomBytes } from 'crypto';
import { getCookieSecureFlag } from '../services/cookies.js';
import { clearFailures, getClientIp, getIpBan, getUserAgent, recordFailureAndMaybeBan } from '../services/loginAttempts.js';
import { getLocationForIp } from '../services/geolocation.js';

const COOKIE_NAME = 'harborfm_jwt';
const CSRF_COOKIE_NAME = 'harborfm_csrf';
// In production, cookies are Secure by default (HTTPS only). Set COOKIE_SECURE=false when using HTTP (e.g. Docker on localhost).
const COOKIE_SECURE = getCookieSecureFlag();
const COOKIE_OPTS = {
  httpOnly: true,
  secure: COOKIE_SECURE,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 60 * 60 * 24 * 7, // 7 days
};
const CSRF_COOKIE_OPTS = {
  httpOnly: false,
  secure: COOKIE_SECURE,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 60 * 60 * 24 * 7, // 7 days
};

function newCsrfToken(): string {
  return randomBytes(32).toString('base64url');
}

export async function authRoutes(app: FastifyInstance) {
  app.post('/api/auth/register', async (request, reply) => {
    // Setup gate: if there are no users, the server must be bootstrapped first.
    // This prevents "first registrant becomes admin" on fresh installs.
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
    if (userCount.count === 0) {
      return reply.status(403).send({ error: 'Server is not set up yet. Check server logs for the setup URL.' });
    }

    // Check if registration is enabled
    const settings = readSettings();
    if (!settings.registration_enabled) {
      return reply.status(403).send({ error: 'Registration is currently disabled' });
    }
    
    const parsed = registerBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
    }
    const { email, password } = parsed.data;
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
      return reply.status(409).send({ error: 'Email already registered' });
    }
    
    const id = nanoid();
    const userRole = 'user';
    const password_hash = await argon2.hash(password);
    db.prepare(
      'INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, ?)'
    ).run(id, email, password_hash, userRole);
    // Record initial login metadata (register returns an auth cookie, so treat as a login).
    const ip = getClientIp(request);
    const userAgent = getUserAgent(request);
    const location = await getLocationForIp(ip).catch(() => null);
    db.prepare(
      `UPDATE users SET last_login_at = datetime('now'), last_login_ip = ?, last_login_user_agent = ?, last_login_location = ? WHERE id = ?`
    ).run(ip, userAgent, location ?? null, id);
    const token = app.jwt.sign(
      { sub: id, email },
      { expiresIn: '7d' }
    );
    return reply
      .setCookie(COOKIE_NAME, token, COOKIE_OPTS)
      .setCookie(CSRF_COOKIE_NAME, newCsrfToken(), CSRF_COOKIE_OPTS)
      .send({ user: { id, email } });
  });

  app.post('/api/auth/login', async (request, reply) => {
    const ip = getClientIp(request);
    const userAgent = getUserAgent(request);
    const ban = getIpBan(ip, 'auth_login');
    if (ban.banned) {
      return reply
        .status(429)
        .header('Retry-After', String(ban.retryAfterSec))
        .send({ error: 'Too many failed login attempts. Try again in a few minutes.' });
    }

    const parsed = loginBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
    }
    const { email, password } = parsed.data;
    const row = db.prepare('SELECT id, password_hash, COALESCE(disabled, 0) as disabled FROM users WHERE email = ?').get(email) as
      | { id: string; password_hash: string; disabled: number }
      | undefined;
    if (!row || !(await argon2.verify(row.password_hash, password))) {
      // Record failed attempt unless banned (checked above).
      const after = recordFailureAndMaybeBan(ip, 'auth_login', { attemptedEmail: email, userAgent });
      if (after.bannedNow) {
        return reply
          .status(429)
          .header('Retry-After', String(after.retryAfterSec))
          .send({ error: 'Too many failed login attempts. Try again in a few minutes.' });
      }
      return reply.status(401).send({ error: 'Invalid email or password' });
    }
    if (row.disabled === 1) {
      return reply.status(403).send({ error: 'Account is disabled' });
    }

    // Successful login: clear failures for this IP/context (best-effort).
    clearFailures(ip, 'auth_login');

    // Record last login metadata (best-effort).
    try {
      const location = await getLocationForIp(ip).catch(() => null);
      db.prepare(
        `UPDATE users SET last_login_at = datetime('now'), last_login_ip = ?, last_login_user_agent = ?, last_login_location = ? WHERE id = ?`
      ).run(ip, userAgent, location ?? null, row.id);
    } catch {
      // ignore
    }

    const token = app.jwt.sign(
      { sub: row.id, email },
      { expiresIn: '7d' }
    );
    return reply
      .setCookie(COOKIE_NAME, token, COOKIE_OPTS)
      .setCookie(CSRF_COOKIE_NAME, newCsrfToken(), CSRF_COOKIE_OPTS)
      .send({ user: { id: row.id, email } });
  });

  app.post('/api/auth/logout', async (_request, reply) => {
    return reply
      .clearCookie(COOKIE_NAME, { path: '/' })
      .clearCookie(CSRF_COOKIE_NAME, { path: '/' })
      .send({ ok: true });
  });

  app.get('/api/auth/me', { preHandler: [requireAuth] }, async (request, reply) => {
    const user = db.prepare('SELECT id, email, role FROM users WHERE id = ?').get(request.userId) as { id: string; email: string; role: string } | undefined;
    if (!user) {
      return reply.status(404).send({ error: 'User not found' });
    }
    return { user: { id: user.id, email: user.email, role: user.role } };
  });
}
