import type { FastifyRequest } from "fastify";
import {
  LOGIN_BAN_MINUTES,
  LOGIN_FAILURE_THRESHOLD,
  LOGIN_WINDOW_MINUTES,
} from "../config.js";
import { db } from "../db/index.js";

export type AttemptContext =
  | "auth_login"
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
  const row = db
    .prepare(
      `
      SELECT
        banned_until,
        CAST(CEIL((julianday(banned_until) - julianday('now')) * 86400.0) AS INTEGER) AS retry_after_sec
      FROM ip_bans
      WHERE ip = ? AND context = ? AND datetime(banned_until) > datetime('now')
      LIMIT 1
    `,
    )
    .get(ip, context) as
    | { banned_until: string; retry_after_sec: number }
    | undefined;

  if (!row) return { banned: false, retryAfterSec: 0 };
  const retryAfterSec = Math.max(1, Number(row.retry_after_sec) || 1);
  console.log(`[ban] IP ${ip} context=${context}: request blocked (already banned)`);
  return { banned: true, retryAfterSec };
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
  db.prepare(
    "INSERT INTO login_attempts (ip, context, attempted_email, user_agent) VALUES (?, ?, ?, ?)",
  ).run(ip, context, attemptedEmail, userAgent);

  // Count failures in recent window
  const row = db
    .prepare(
      `
      SELECT COUNT(*) AS count
      FROM login_attempts
      WHERE ip = ? AND context = ?
        AND datetime(created_at) >= datetime('now', ?)
    `,
    )
    .get(ip, context, `-${LOGIN_WINDOW_MINUTES} minutes`) as { count: number };

  const failures = Number(row?.count ?? 0);
  console.log(`[ban] IP ${ip} context=${context}: recorded failure, failuresInWindow=${failures} (threshold=${LOGIN_FAILURE_THRESHOLD})`);
  if (failures <= LOGIN_FAILURE_THRESHOLD) {
    return { bannedNow: false, retryAfterSec: 0, failuresInWindow: failures };
  }

  // Ban for BAN_MINUTES minutes from now
  console.log(`[ban] IP ${ip} context=${context}: BANNED for ${LOGIN_BAN_MINUTES} min (failures=${failures})`);
  db.prepare(
    `
    INSERT INTO ip_bans (ip, context, banned_until)
    VALUES (?, ?, datetime('now', ?))
    ON CONFLICT(ip, context) DO UPDATE SET
      banned_until = excluded.banned_until,
      updated_at = datetime('now')
  `,
  ).run(ip, context, `+${LOGIN_BAN_MINUTES} minutes`);

  // Compute retry-after from DB for consistency.
  const ban = getIpBan(ip, context);
  return {
    bannedNow: true,
    retryAfterSec: ban.retryAfterSec || LOGIN_BAN_MINUTES * 60,
    failuresInWindow: failures,
  };
}

export function clearFailures(ip: string, context: AttemptContext): void {
  // Best-effort: cleanup old failures for this IP/context after a successful action.
  db.prepare("DELETE FROM login_attempts WHERE ip = ? AND context = ?").run(
    ip,
    context,
  );
}
