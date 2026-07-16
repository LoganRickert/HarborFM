import { randomBytes } from "crypto";
import { eq } from "drizzle-orm";
import { VERIFICATION_TOKEN_BYTES } from "../../config.js";
import { drizzleDb } from "../../db/drizzle.js";
import { episodeAlertSubscribers } from "../../db/schema.js";
import { sha256Hex } from "../../utils/hash.js";

/** Persist SHA-256 of unsubscribe token for lookup. */
export function hashUnsubscribeToken(raw: string): string {
  return sha256Hex(raw);
}

/** Rotate unsubscribe token and return the new raw token for email links. */
export function rotateUnsubscribeToken(subscriberId: string): string {
  const raw = randomBytes(VERIFICATION_TOKEN_BYTES).toString("base64url");
  drizzleDb
    .update(episodeAlertSubscribers)
    .set({ unsubscribeTokenHash: hashUnsubscribeToken(raw) })
    .where(eq(episodeAlertSubscribers.id, subscriberId))
    .run();
  return raw;
}
