/**
 * Dial-in IVR rate limits and abuse guards.
 * Complements per-leg max PIN attempts (DIAL_IN_MAX_PIN_ATTEMPTS).
 */

import {
  DIAL_IN_MAX_CONCURRENT_LEGS_GLOBAL,
  DIAL_IN_MAX_CONCURRENT_LEGS_PER_CALLER,
  DIAL_IN_MAX_INBOUND_PER_CALLER,
  DIAL_IN_MAX_PIN_FAILURES,
} from "../../../config.js";

const WINDOW_MS = 10 * 60 * 1000;

type WindowBucket = { count: number; windowStart: number };

const pinFailuresByCaller = new Map<string, WindowBucket>();
const inboundByCaller = new Map<string, WindowBucket>();

function keyFor(from: string): string {
  const digits = from.replace(/\D/g, "");
  return digits || from.trim() || "unknown";
}

function bump(
  map: Map<string, WindowBucket>,
  key: string,
  max: number,
): boolean {
  const now = Date.now();
  let bucket = map.get(key);
  if (!bucket || now - bucket.windowStart > WINDOW_MS) {
    bucket = { count: 0, windowStart: now };
    map.set(key, bucket);
  }
  bucket.count += 1;
  return bucket.count > max;
}

function isOver(
  map: Map<string, WindowBucket>,
  key: string,
  max: number,
): boolean {
  const bucket = map.get(key);
  if (!bucket) return false;
  if (Date.now() - bucket.windowStart > WINDOW_MS) {
    map.delete(key);
    return false;
  }
  return bucket.count >= max;
}

export function resetPinRateLimit(): void {
  pinFailuresByCaller.clear();
  inboundByCaller.clear();
}

/** Record a failed PIN attempt. Returns true if caller is now rate-limited. */
export function recordPinFailure(from: string): boolean {
  return bump(pinFailuresByCaller, keyFor(from), DIAL_IN_MAX_PIN_FAILURES);
}

export function isPinRateLimited(from: string): boolean {
  return isOver(pinFailuresByCaller, keyFor(from), DIAL_IN_MAX_PIN_FAILURES);
}

/**
 * Record an answered inbound dial-in. Returns true if this caller should be
 * rejected (too many inbound attempts in the window).
 */
export function recordInboundAttempt(from: string): boolean {
  return bump(inboundByCaller, keyFor(from), DIAL_IN_MAX_INBOUND_PER_CALLER);
}

export function isInboundRateLimited(from: string): boolean {
  return isOver(inboundByCaller, keyFor(from), DIAL_IN_MAX_INBOUND_PER_CALLER);
}

export type ConcurrentLegLike = {
  from: string;
  status: string;
};

/** True if accepting another leg would exceed per-caller or global caps. */
export function isConcurrentDialInLimited(
  from: string,
  legs: ConcurrentLegLike[],
): boolean {
  const active = legs.filter((l) => l.status !== "ended");
  // `legs` already includes the current answered leg.
  if (active.length > DIAL_IN_MAX_CONCURRENT_LEGS_GLOBAL) return true;
  const key = keyFor(from);
  const fromCaller = active.filter((l) => keyFor(l.from) === key).length;
  return fromCaller > DIAL_IN_MAX_CONCURRENT_LEGS_PER_CALLER;
}
