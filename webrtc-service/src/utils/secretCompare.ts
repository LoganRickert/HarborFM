import { timingSafeEqual } from "crypto";

/**
 * Timing-safe string comparison to prevent secret extraction via timing side channels.
 * Returns false if lengths differ (avoids leaking length via timing).
 */
export function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
