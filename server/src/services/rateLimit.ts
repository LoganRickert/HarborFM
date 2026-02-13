import type { FastifyReply, FastifyRequest } from "fastify";

type BucketKey = string;

// Per-process, in-memory limiter (good enough for single-node deployments).
const lastSeen = new Map<BucketKey, number>();
let lastPruneAt = 0;

function prune(now: number) {
  // Best-effort pruning to avoid unbounded growth.
  if (now - lastPruneAt < 60_000) return;
  lastPruneAt = now;
  const cutoff = now - 5 * 60_000; // keep 5 minutes of history
  for (const [k, ts] of lastSeen) {
    if (ts < cutoff) lastSeen.delete(k);
  }
}

export function userRateLimitPreHandler(opts: {
  bucket: string;
  windowMs?: number;
}) {
  const windowMs = opts.windowMs ?? 1000;
  const bucket = opts.bucket;

  return async function rateLimit(
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    const userId = (request as FastifyRequest & { userId?: string }).userId;
    // If no userId, skip (this limiter is meant for authed routes).
    if (!userId) return;

    const now = Date.now();
    prune(now);

    const key: BucketKey = `${bucket}:${userId}`;
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
          error: "Too many requests. Please wait a moment and try again.",
        });
      return;
    }

    lastSeen.set(key, now);
  };
}
