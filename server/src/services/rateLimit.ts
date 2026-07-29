import type { FastifyReply, FastifyRequest } from "fastify";

type BucketKey = string;

// Per-process, in-memory limiter (good enough for single-node deployments).
const lastSeen = new Map<BucketKey, number>();
const timestamps = new Map<BucketKey, number[]>();
let lastPruneAt = 0;

function prune(now: number) {
  // Best-effort pruning to avoid unbounded growth.
  if (now - lastPruneAt < 60_000) return;
  lastPruneAt = now;
  const cutoff = now - 5 * 60_000; // keep 5 minutes of history
  for (const [k, ts] of lastSeen) {
    if (ts < cutoff) lastSeen.delete(k);
  }
  for (const [k, arr] of timestamps) {
    if (arr.length > 0 && arr[arr.length - 1]! < cutoff) timestamps.delete(k);
  }
}

/** Human window length for rate-limit copy (e.g. "30 seconds", "1 minute"). */
function formatWindowDuration(windowMs: number): string {
  const sec = Math.max(1, Math.ceil(windowMs / 1000));
  if (sec < 60) return `${sec} second${sec === 1 ? "" : "s"}`;
  if (sec % 60 === 0) {
    const min = sec / 60;
    return `${min} minute${min === 1 ? "" : "s"}`;
  }
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return `${min} minute${min === 1 ? "" : "s"} ${rem} second${rem === 1 ? "" : "s"}`;
}

function rateLimitErrorMessage(opts: {
  windowMs: number;
  retryAfterSec: number;
  actionLabel?: string;
}): string {
  const retry =
    opts.retryAfterSec >= 60
      ? `${Math.ceil(opts.retryAfterSec / 60)} minute${Math.ceil(opts.retryAfterSec / 60) === 1 ? "" : "s"}`
      : `${opts.retryAfterSec} second${opts.retryAfterSec === 1 ? "" : "s"}`;
  if (opts.actionLabel) {
    return `You can only ${opts.actionLabel} once every ${formatWindowDuration(opts.windowMs)}. Please try again in ${retry}.`;
  }
  return `Too many requests. Please try again in ${retry}.`;
}

export function userRateLimitPreHandler(opts: {
  bucket: string;
  windowMs?: number;
  /** Max requests allowed within window. Default 1 (one request per window). */
  max?: number;
  /** Optional verb phrase for copy, e.g. "run Make Final Episode". */
  actionLabel?: string;
}) {
  const windowMs = opts.windowMs ?? 1000;
  const max = opts.max ?? 1;
  const bucket = opts.bucket;
  const actionLabel = opts.actionLabel;

  return async function rateLimit(
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    const userId = (request as FastifyRequest & { userId?: string }).userId;
    // If no userId, skip (this limiter is meant for authed routes).
    if (!userId) return;
    // windowMs <= 0 disables the limiter (e.g. e2e overrides).
    if (windowMs <= 0) return;

    const now = Date.now();
    prune(now);

    const key: BucketKey = `${bucket}:${userId}`;

    if (max <= 1) {
      const prev = lastSeen.get(key);
      if (prev !== undefined && now - prev < windowMs) {
        const retryAfterSec = Math.max(
          1,
          Math.ceil((windowMs - (now - prev)) / 1000),
        );
        reply
          .code(429)
          .header("Retry-After", String(retryAfterSec))
          .send({
            error: rateLimitErrorMessage({
              windowMs,
              retryAfterSec,
              actionLabel,
            }),
          });
        return;
      }
      lastSeen.set(key, now);
      return;
    }

    let arr = timestamps.get(key) ?? [];
    arr = arr.filter((t) => now - t < windowMs);
    if (arr.length >= max) {
      const oldestInWindow = arr[0]!;
      const retryAfterSec = Math.max(
        1,
        Math.ceil((windowMs - (now - oldestInWindow)) / 1000),
      );
      reply
        .code(429)
        .header("Retry-After", String(retryAfterSec))
        .send({
          error: rateLimitErrorMessage({
            windowMs,
            retryAfterSec,
            actionLabel,
          }),
        });
      return;
    }
    arr.push(now);
    timestamps.set(key, arr);
  };
}
