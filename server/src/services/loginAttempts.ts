import type { FastifyRequest } from "fastify";
import { sql } from "drizzle-orm";
import { and, eq } from "drizzle-orm";
import {
  CALL_JOIN_FAILURE_THRESHOLD,
  LOGIN_BAN_MINUTES,
  LOGIN_FAILURE_THRESHOLD,
  LOGIN_WINDOW_MINUTES,
} from "../config.js";
import { drizzleDb } from "../db/drizzle.js";
import { ipBans, loginAttempts, userTotpAttempts, users } from "../db/schema.js";
import { sqlNow } from "../db/utils.js";

export type AttemptContext =
  | "auth_login"
  | "auth_totp"
  | "setup"
  | "auth_apikey"
  | "auth_subscriber_token"
  | "call_join";

export function getClientIp(request: FastifyRequest): string {
  // Note: if you run behind a reverse proxy, configure Fastify trustProxy so request.ip is correct.
  return (request.ip || "").trim() || "unknown";
}

export function getUserAgent(request: FastifyRequest): string {
  const headers = request.headers as unknown as Record<string, unknown>;
  const ua = headers["user-agent"];
  if (typeof ua === "string") return ua.trim();
  if (Array.isArray(ua) && typeof ua[0] === "string") return ua[0].trim();
  return "";
}

export function getIpBan(
  ip: string,
  context: AttemptContext,
): { banned: boolean; retryAfterSec: number } {
  const row = drizzleDb
    .select({
      bannedUntil: ipBans.bannedUntil,
      retryAfterSec: sql<number>`CAST(CEIL((julianday(${ipBans.bannedUntil}) - julianday('now')) * 86400.0) AS INTEGER)`,
    })
    .from(ipBans)
    .where(
      and(
        eq(ipBans.ip, ip),
        eq(ipBans.context, context),
        sql`datetime(${ipBans.bannedUntil}) > datetime('now')`,
      ),
    )
    .limit(1)
    .get() as { bannedUntil: string; retryAfterSec: number } | undefined;

  if (!row) return { banned: false, retryAfterSec: 0 };
  const retryAfterSec = Math.max(1, Number(row.retryAfterSec) || 1);
  return { banned: true, retryAfterSec };
}

function getThresholdForContext(context: AttemptContext): number {
  return context === "call_join" ? CALL_JOIN_FAILURE_THRESHOLD : LOGIN_FAILURE_THRESHOLD;
}

export function recordFailureAndMaybeBan(
  ip: string,
  context: AttemptContext,
  meta?: { attemptedEmail?: string; userAgent?: string },
): { bannedNow: boolean; retryAfterSec: number; failuresInWindow: number } {
  // Insert failure attempt
  const attemptedEmail = meta?.attemptedEmail
    ? String(meta.attemptedEmail).trim().toLowerCase()
    : null;
  const userAgent = meta?.userAgent ? String(meta.userAgent).trim() : null;
  drizzleDb.insert(loginAttempts).values({
    ip,
    context,
    attemptedEmail,
    userAgent,
  }).run();

  // Count failures in recent window
  const countRow = drizzleDb
    .select({
      count: sql<number>`COUNT(*)`,
    })
    .from(loginAttempts)
    .where(
      and(
        eq(loginAttempts.ip, ip),
        eq(loginAttempts.context, context),
        sql`datetime(${loginAttempts.createdAt}) >= datetime('now', ${`-${LOGIN_WINDOW_MINUTES} minutes`})`,
      ),
    )
    .get() as { count: number };

  const failures = Number(countRow?.count ?? 0);
  const threshold = getThresholdForContext(context);
  if (failures <= threshold) {
    return { bannedNow: false, retryAfterSec: 0, failuresInWindow: failures };
  }

  // Ban for BAN_MINUTES minutes from now
  const bannedUntilDate = new Date();
  bannedUntilDate.setMinutes(bannedUntilDate.getMinutes() + LOGIN_BAN_MINUTES);
  const bannedUntilStr = bannedUntilDate.toISOString().slice(0, 19).replace("T", " ");
  const now = sqlNow();
  drizzleDb
    .insert(ipBans)
    .values({
      ip,
      context,
      bannedUntil: bannedUntilStr,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [ipBans.ip, ipBans.context],
      set: {
        bannedUntil: bannedUntilStr,
        updatedAt: now,
      },
    })
    .run();

  // Compute retry-after from DB for consistency.
  const ban = getIpBan(ip, context);
  return {
    bannedNow: true,
    retryAfterSec: ban.retryAfterSec || LOGIN_BAN_MINUTES * 60,
    failuresInWindow: failures,
  };
}

/** Record TOTP failure, check lockout. Returns { locked, retryAfterSec } when user is locked. */
export function recordTOTPFailureAndCheckLockout(
  userId: string,
  ip: string,
  userAgent: string,
): { locked: boolean; retryAfterSec?: number } {
  drizzleDb.insert(userTotpAttempts).values({
    userId,
    createdAt: sqlNow(),
  }).run();

  const countRow = drizzleDb
    .select({
      cnt: sql<number>`COUNT(*)`,
    })
    .from(userTotpAttempts)
    .where(
      and(
        eq(userTotpAttempts.userId, userId),
        sql`datetime(${userTotpAttempts.createdAt}) >= datetime('now', '-15 minutes')`,
      ),
    )
    .get() as { cnt: number };

  const failures = Number(countRow?.cnt ?? 0);
  if (failures < 5) {
    return { locked: false };
  }

  const totpLockedUntilDate = new Date();
  totpLockedUntilDate.setMinutes(totpLockedUntilDate.getMinutes() + 15);
  const totpLockedUntilStr = totpLockedUntilDate.toISOString().slice(0, 19).replace("T", " ");
  drizzleDb
    .update(users)
    .set({ totpLockedUntil: totpLockedUntilStr })
    .where(eq(users.id, userId))
    .run();
  recordFailureAndMaybeBan(ip, "auth_totp", { userAgent });
  return { locked: true, retryAfterSec: 900 };
}

export function clearFailures(ip: string, context: AttemptContext): void {
  // Best-effort: cleanup old failures for this IP/context after a successful action.
  drizzleDb
    .delete(loginAttempts)
    .where(and(eq(loginAttempts.ip, ip), eq(loginAttempts.context, context)))
    .run();
}
