import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { eq, sql } from "drizzle-orm";
import { drizzleDb } from "../db/index.js";
import { apiKeys, users } from "../db/schema.js";
import { sqlNow } from "../db/utils.js";
import { randomBytes } from "crypto";
import { getCookieSecureFlag } from "../services/cookies.js";
import { sha256Hex } from "../utils/hash.js";
import {
  API_KEY_PREFIX,
  CSRF_COOKIE_NAME,
  CSRF_COOKIE_MAX_AGE_SECONDS,
} from "../config.js";
import {
  getClientIp,
  getUserAgent,
  getIpBan,
  recordFailureAndMaybeBan,
} from "../services/loginAttempts.js";
import type { AttemptContext } from "../services/loginAttempts.js";

const CSRF_COOKIE_OPTS = {
  httpOnly: false,
  secure: getCookieSecureFlag(),
  sameSite: "lax" as const,
  path: "/",
  maxAge: CSRF_COOKIE_MAX_AGE_SECONDS,
};

function isUnsafeMethod(method: string): boolean {
  const m = method.toUpperCase();
  return m !== "GET" && m !== "HEAD" && m !== "OPTIONS";
}

function getHeaderValue(h: unknown): string | undefined {
  if (typeof h === "string") return h;
  if (Array.isArray(h)) return typeof h[0] === "string" ? h[0] : undefined;
  return undefined;
}

function newCsrfToken(): string {
  return randomBytes(32).toString("base64url");
}

export interface JWTPayload {
  sub: string;
  /** Actual email address, or null if user has no email (e.g. federated without one). */
  email?: string | null;
  /** Username/handle, separate from email. */
  username?: string | null;
  iat: number;
  exp: number;
}

declare module "fastify" {
  interface FastifyInstance {
    requireAuth: (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<void>;
    /** Like requireAuth but allows disabled users (e.g. so they can call logout after disabling). */
    requireAuthAllowDisabled: (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<void>;
    requireAdmin: (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<void>;
    requireNotReadOnly: (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<void>;
  }
  interface FastifyRequest {
    userId: string;
    /** True if authenticated via API key (Bearer hfm_...). Use requireSession for routes that must use cookie/JWT. */
    authViaApiKey?: boolean;
  }
}

function getBearerToken(request: FastifyRequest): string | undefined {
  const auth = getHeaderValue(request.headers["authorization"]);
  if (!auth || !auth.startsWith("Bearer ")) return undefined;
  return auth.slice(7).trim() || undefined;
}

const AUTH_APIKEY_CONTEXT: AttemptContext = "auth_apikey";

/** If Authorization: Bearer hfm_... is present, validate as API key. Returns userId, "expired", or null (unknown/invalid hash). */
function authViaApiKey(
  request: FastifyRequest,
): string | "expired" | null {
  const token = getBearerToken(request);
  if (!token || !token.startsWith(API_KEY_PREFIX)) return null;
  const keyHash = sha256Hex(token);
  const row = drizzleDb
    .select({
      user_id: apiKeys.userId,
      valid_until: apiKeys.validUntil,
      disabled: sql<number>`COALESCE(${apiKeys.disabled}, 0)`.as("disabled"),
      valid_from: apiKeys.validFrom,
    })
    .from(apiKeys)
    .where(eq(apiKeys.keyHash, keyHash))
    .limit(1)
    .get();
  if (!row) return null;
  if (row.disabled === 1) return "expired";
  const now = new Date().toISOString();
  if (row.valid_from != null && row.valid_from > now) return "expired";
  if (row.valid_until != null && row.valid_until < now) return "expired";
  drizzleDb
    .update(apiKeys)
    .set({ lastUsedAt: sqlNow() })
    .where(eq(apiKeys.keyHash, keyHash))
    .run();
  return row.user_id;
}

/** Shared handler so routes can use it even when registered in a child context (e.g. with prefix). */
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const apiKeyResult = authViaApiKey(request);
  if (typeof apiKeyResult === "string" && apiKeyResult !== "expired") {
    const userId = apiKeyResult;
    const user = drizzleDb
      .select({
        disabled: sql<number>`COALESCE(${users.disabled}, 0)`.as("disabled"),
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
      .get();
    if (!user || user.disabled === 1) {
      return reply.status(403).send({ error: "Account is disabled" });
    }
    request.userId = userId;
    request.authViaApiKey = true;
    return;
  }
  if (apiKeyResult === "expired") {
    return reply.status(401).send({ error: "Unauthorized" });
  }
  const token = getBearerToken(request);
  if (token != null && token.startsWith(API_KEY_PREFIX)) {
    const ip = getClientIp(request);
    request.log.warn({ ip }, "Bad/unknown API key attempt");
    const userAgent = getUserAgent(request);
    recordFailureAndMaybeBan(ip, AUTH_APIKEY_CONTEXT, { userAgent });
    const ban = getIpBan(ip, AUTH_APIKEY_CONTEXT);
    if (ban.banned) {
      return reply
        .status(429)
        .header("Retry-After", String(ban.retryAfterSec))
        .send({ error: "Too many failed attempts. Try again later." });
    }
    return reply.status(401).send({ error: "Unauthorized" });
  }

  try {
    await request.jwtVerify();
    const payload = request.user as JWTPayload;
    const userId = payload.sub;

    // Check if user is disabled
    const user = drizzleDb
      .select({
        disabled: sql<number>`COALESCE(${users.disabled}, 0)`.as("disabled"),
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
      .get();
    if (!user || user.disabled === 1) {
      return reply.status(403).send({ error: "Account is disabled" });
    }

    // CSRF protection for cookie-based auth (double-submit token).
    // Client must echo back the readable cookie value in `x-csrf-token` for unsafe methods.
    const cookies = (
      request as unknown as { cookies?: Record<string, string | undefined> }
    ).cookies;
    const csrfCookie = cookies?.[CSRF_COOKIE_NAME];
    if (!csrfCookie) {
      reply.setCookie(CSRF_COOKIE_NAME, newCsrfToken(), CSRF_COOKIE_OPTS);
      if (isUnsafeMethod(request.method)) {
        return reply
          .status(403)
          .send({ error: "CSRF token missing. Refresh and try again." });
      }
    } else if (isUnsafeMethod(request.method)) {
      const header = getHeaderValue(request.headers["x-csrf-token"]);
      if (!header || header !== csrfCookie) {
        return reply.status(403).send({ error: "CSRF token invalid" });
      }
    }

    request.userId = userId;
  } catch {
    return reply.status(401).send({ error: "Unauthorized" });
  }
}

/** Same as requireAuth but does not reject disabled users. Use only for logout so disabled users can clear their session. */
export async function requireAuthAllowDisabled(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const apiKeyResult = authViaApiKey(request);
  if (typeof apiKeyResult === "string" && apiKeyResult !== "expired") {
    request.userId = apiKeyResult;
    request.authViaApiKey = true;
    return;
  }
  if (apiKeyResult === "expired") {
    return reply.status(401).send({ error: "Unauthorized" });
  }
  const token = getBearerToken(request);
  if (token != null && token.startsWith(API_KEY_PREFIX)) {
    const ip = getClientIp(request);
    request.log.warn({ ip }, "Bad/unknown API key attempt");
    const userAgent = getUserAgent(request);
    recordFailureAndMaybeBan(ip, AUTH_APIKEY_CONTEXT, { userAgent });
    const ban = getIpBan(ip, AUTH_APIKEY_CONTEXT);
    if (ban.banned) {
      return reply
        .status(429)
        .header("Retry-After", String(ban.retryAfterSec))
        .send({ error: "Too many failed attempts. Try again later." });
    }
    return reply.status(401).send({ error: "Unauthorized" });
  }

  try {
    await request.jwtVerify();
    const payload = request.user as JWTPayload;
    const userId = payload.sub;

    // Do not check disabled here so that disabled users can still call logout.

    const cookies = (
      request as unknown as { cookies?: Record<string, string | undefined> }
    ).cookies;
    const csrfCookie = cookies?.[CSRF_COOKIE_NAME];
    if (!csrfCookie) {
      reply.setCookie(CSRF_COOKIE_NAME, newCsrfToken(), CSRF_COOKIE_OPTS);
      if (isUnsafeMethod(request.method)) {
        return reply
          .status(403)
          .send({ error: "CSRF token missing. Refresh and try again." });
      }
    } else if (isUnsafeMethod(request.method)) {
      const header = getHeaderValue(request.headers["x-csrf-token"]);
      if (!header || header !== csrfCookie) {
        return reply.status(403).send({ error: "CSRF token invalid" });
      }
    }

    request.userId = userId;
  } catch {
    return reply.status(401).send({ error: "Unauthorized" });
  }
}

/** Require admin role */
export async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  await requireAuth(request, reply);
  if (reply.sent) return; // Already sent a response (unauthorized/disabled)

  const user = drizzleDb
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, request.userId))
    .limit(1)
    .get();
  if (!user || user.role !== "admin") {
    return reply.status(403).send({ error: "Admin access required" });
  }
}

/** Reject read-only users (must be used after requireAuth). */
export async function requireNotReadOnly(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const row = drizzleDb
    .select({
      read_only: sql<number>`COALESCE(${users.readOnly}, 0)`.as("read_only"),
    })
    .from(users)
    .where(eq(users.id, request.userId))
    .limit(1)
    .get();
  if (row?.read_only === 1) {
    return reply
      .status(403)
      .send({ error: "Read-only access; this action is not allowed." });
  }
}

export async function authPlugin(app: FastifyInstance) {
  app.decorate("requireAuth", requireAuth);
  app.decorate("requireAuthAllowDisabled", requireAuthAllowDisabled);
  app.decorate("requireAdmin", requireAdmin);
  app.decorate("requireNotReadOnly", requireNotReadOnly);
}
