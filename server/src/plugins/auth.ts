import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../db/index.js';
import { randomBytes } from 'crypto';
import { getCookieSecureFlag } from '../services/cookies.js';
import { sha256Hex } from '../utils/hash.js';
import { API_KEY_PREFIX, CSRF_COOKIE_NAME } from '../config.js';

const CSRF_COOKIE_OPTS = {
  httpOnly: false,
  secure: getCookieSecureFlag(),
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 60 * 60 * 24 * 7, // 7 days
};

function isUnsafeMethod(method: string): boolean {
  const m = method.toUpperCase();
  return m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS';
}

function getHeaderValue(h: unknown): string | undefined {
  if (typeof h === 'string') return h;
  if (Array.isArray(h)) return typeof h[0] === 'string' ? h[0] : undefined;
  return undefined;
}

function newCsrfToken(): string {
  return randomBytes(32).toString('base64url');
}

export interface JWTPayload {
  sub: string;
  email: string;
  iat: number;
  exp: number;
}

declare module 'fastify' {
  interface FastifyInstance {
    requireAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireNotReadOnly: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    userId: string;
    /** True if authenticated via API key (Bearer hfm_...). Use requireSession for routes that must use cookie/JWT. */
    authViaApiKey?: boolean;
  }
}

function getBearerToken(request: FastifyRequest): string | undefined {
  const auth = getHeaderValue(request.headers['authorization']);
  if (!auth || !auth.startsWith('Bearer ')) return undefined;
  return auth.slice(7).trim() || undefined;
}

/** If Authorization: Bearer hfm_... is present, validate as API key and return userId; else null. */
function authViaApiKey(request: FastifyRequest): string | null {
  const token = getBearerToken(request);
  if (!token || !token.startsWith(API_KEY_PREFIX)) return null;
  const keyHash = sha256Hex(token);
  const row = db
    .prepare(
      'SELECT user_id FROM api_keys WHERE key_hash = ?'
    )
    .get(keyHash) as { user_id: string } | undefined;
  if (!row) return null;
  db.prepare('UPDATE api_keys SET last_used_at = datetime(\'now\') WHERE key_hash = ?').run(keyHash);
  return row.user_id;
}

/** Shared handler so routes can use it even when registered in a child context (e.g. with prefix). */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const apiKeyUserId = authViaApiKey(request);
  if (apiKeyUserId) {
    const user = db.prepare('SELECT COALESCE(disabled, 0) as disabled FROM users WHERE id = ?').get(apiKeyUserId) as { disabled: number } | undefined;
    if (!user || user.disabled === 1) {
      return reply.status(403).send({ error: 'Account is disabled' });
    }
    request.userId = apiKeyUserId;
    request.authViaApiKey = true;
    return;
  }

  try {
    await request.jwtVerify();
    const payload = request.user as JWTPayload;
    const userId = payload.sub;
    
    // Check if user is disabled
    const user = db.prepare('SELECT COALESCE(disabled, 0) as disabled FROM users WHERE id = ?').get(userId) as { disabled: number } | undefined;
    if (!user || user.disabled === 1) {
      return reply.status(403).send({ error: 'Account is disabled' });
    }

    // CSRF protection for cookie-based auth (double-submit token).
    // Client must echo back the readable cookie value in `x-csrf-token` for unsafe methods.
    const cookies = (request as unknown as { cookies?: Record<string, string | undefined> }).cookies;
    const csrfCookie = cookies?.[CSRF_COOKIE_NAME];
    if (!csrfCookie) {
      reply.setCookie(CSRF_COOKIE_NAME, newCsrfToken(), CSRF_COOKIE_OPTS);
      if (isUnsafeMethod(request.method)) {
        return reply.status(403).send({ error: 'CSRF token missing. Refresh and try again.' });
      }
    } else if (isUnsafeMethod(request.method)) {
      const header = getHeaderValue(request.headers['x-csrf-token']);
      if (!header || header !== csrfCookie) {
        return reply.status(403).send({ error: 'CSRF token invalid' });
      }
    }
    
    request.userId = userId;
  } catch {
    return reply.status(401).send({ error: 'Unauthorized' });
  }
}

/** Require admin role */
export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await requireAuth(request, reply);
  if (reply.sent) return; // Already sent a response (unauthorized/disabled)
  
  const user = db.prepare('SELECT role FROM users WHERE id = ?').get(request.userId) as { role: string } | undefined;
  if (!user || user.role !== 'admin') {
    return reply.status(403).send({ error: 'Admin access required' });
  }
}

/** Reject read-only users (must be used after requireAuth). */
export async function requireNotReadOnly(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const row = db.prepare('SELECT COALESCE(read_only, 0) AS read_only FROM users WHERE id = ?').get(request.userId) as { read_only: number } | undefined;
  if (row?.read_only === 1) {
    return reply.status(403).send({ error: 'Read-only access; this action is not allowed.' });
  }
}

export async function authPlugin(app: FastifyInstance) {
  app.decorate('requireAuth', requireAuth);
  app.decorate('requireAdmin', requireAdmin);
  app.decorate('requireNotReadOnly', requireNotReadOnly);
}
