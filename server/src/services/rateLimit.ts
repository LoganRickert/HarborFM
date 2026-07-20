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

export function userRateLimitPreHandler(opts: {
  bucket: string;
  windowMs?: number;
  /** Max requests allowed within window. Default 1 (one request per window). */
  max?: number;
}) {
  const windowMs = opts.windowMs ?? 1000;
  const max = opts.max ?? 1;
  const bucket = opts.bucket;

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
        const retryMsg =
          retryAfterSec >= 60
            ? `Too many requests. Please try again in ${Math.ceil(retryAfterSec / 60)} minute${Math.ceil(retryAfterSec / 60) === 1 ? "" : "s"}.`
            : `Too many requests. Please try again in ${retryAfterSec} second${retryAfterSec === 1 ? "" : "s"}.`;
        reply
          .code(429)
          .header("Retry-After", String(retryAfterSec))
          .send({ error: retryMsg });
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
      const retryMsg =
        retryAfterSec >= 60
          ? `Too many requests. Please try again in ${Math.ceil(retryAfterSec / 60)} minute${Math.ceil(retryAfterSec / 60) === 1 ? "" : "s"}.`
          : `Too many requests. Please try again in ${retryAfterSec} second${retryAfterSec === 1 ? "" : "s"}.`;
      reply
        .code(429)
        .header("Retry-After", String(retryAfterSec))
        .send({ error: retryMsg });
      return;
    }
    arr.push(now);
    timestamps.set(key, arr);
  };
}
