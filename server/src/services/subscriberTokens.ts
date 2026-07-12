import { and, eq, sql } from "drizzle-orm";
import { drizzleDb } from "../db/drizzle.js";
import { podcasts, subscriberTokens, users } from "../db/schema.js";
import { sqlNow } from "../db/utils.js";
import { sha256Hex } from "../utils/hash.js";

export interface SubscriberTokenRow {
  id: string;
  podcastId: string;
  name: string;
  tokenHash: string;
  validFrom: string | null;
  validUntil: string | null;
  disabled: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface ValidateSubscriberTokenResult {
  tokenExists: boolean;
  row: SubscriberTokenRow | null;
}

/**
 * Validate subscriber token with existence distinction: unknown hash vs exists but disabled/expired.
 * - tokenExists: false, row: null to hash not in DB (caller may record bad attempt and ban).
 * - tokenExists: true, row: null to hash exists but disabled/expired/invalid (reject without recording).
 * - tokenExists: true, row to valid token.
 */
export function validateSubscriberTokenByValueWithExistence(
  rawToken: string,
): ValidateSubscriberTokenResult {
  if (!rawToken || typeof rawToken !== "string" || !rawToken.trim())
    return { tokenExists: false, row: null };
  const tokenHash = sha256Hex(rawToken.trim());
  const rowByHash = drizzleDb
    .select({
      id: subscriberTokens.id,
      podcastId: subscriberTokens.podcastId,
      name: subscriberTokens.name,
      tokenHash: subscriberTokens.tokenHash,
      validFrom: subscriberTokens.validFrom,
      validUntil: subscriberTokens.validUntil,
      disabled: subscriberTokens.disabled,
      createdAt: subscriberTokens.createdAt,
      lastUsedAt: subscriberTokens.lastUsedAt,
    })
    .from(subscriberTokens)
    .innerJoin(podcasts, eq(subscriberTokens.podcastId, podcasts.id))
    .innerJoin(users, eq(podcasts.ownerUserId, users.id))
    .where(
      and(
        eq(subscriberTokens.tokenHash, tokenHash),
        sql`COALESCE(${subscriberTokens.disabled}, 0) = 0`,
        sql`COALESCE(${users.disabled}, 0) = 0`,
      ),
    )
    .limit(1)
    .get() as SubscriberTokenRow | undefined;
  if (!rowByHash) {
    const anyRow = drizzleDb
      .select({ id: subscriberTokens.id })
      .from(subscriberTokens)
      .where(eq(subscriberTokens.tokenHash, tokenHash))
      .limit(1)
      .get();
    return {
      tokenExists: Boolean(anyRow),
      row: null,
    };
  }
  const now = new Date().toISOString();
  if (rowByHash.validFrom && rowByHash.validFrom > now)
    return { tokenExists: true, row: null };
  if (rowByHash.validUntil && rowByHash.validUntil < now)
    return { tokenExists: true, row: null };
  return { tokenExists: true, row: rowByHash };
}

/**
 * Validate subscriber token by raw token value (secret). Returns token row if valid; null otherwise.
 * Caller should return 404 on null (do not leak existence).
 * Checks: disabled = 0, valid_from/valid_until (if set), podcast owner not disabled.
 */
export function validateSubscriberTokenByValue(
  rawToken: string,
): SubscriberTokenRow | null {
  const { row } = validateSubscriberTokenByValueWithExistence(rawToken);
  return row;
}

/**
 * Validate subscriber token by token id and podcast id (for media URLs). Returns token row if valid; null otherwise.
 */
export function validateSubscriberTokenById(
  tokenId: string,
  podcastId: string,
): SubscriberTokenRow | null {
  if (!tokenId?.trim() || !podcastId?.trim()) return null;
  const row = drizzleDb
    .select({
      id: subscriberTokens.id,
      podcastId: subscriberTokens.podcastId,
      name: subscriberTokens.name,
      tokenHash: subscriberTokens.tokenHash,
      validFrom: subscriberTokens.validFrom,
      validUntil: subscriberTokens.validUntil,
      disabled: subscriberTokens.disabled,
      createdAt: subscriberTokens.createdAt,
      lastUsedAt: subscriberTokens.lastUsedAt,
    })
    .from(subscriberTokens)
    .innerJoin(podcasts, eq(subscriberTokens.podcastId, podcasts.id))
    .innerJoin(users, eq(podcasts.ownerUserId, users.id))
    .where(
      and(
        eq(subscriberTokens.id, tokenId.trim()),
        eq(subscriberTokens.podcastId, podcastId.trim()),
        sql`COALESCE(${subscriberTokens.disabled}, 0) = 0`,
        sql`COALESCE(${users.disabled}, 0) = 0`,
      ),
    )
    .limit(1)
    .get() as SubscriberTokenRow | undefined;
  if (!row) return null;
  const now = new Date().toISOString();
  if (row.validFrom && row.validFrom > now) return null;
  if (row.validUntil && row.validUntil < now) return null;
  return row;
}

/** Update last_used_at for a token (by id). */
export function touchSubscriberToken(tokenId: string): void {
  drizzleDb
    .update(subscriberTokens)
    .set({ lastUsedAt: sqlNow() })
    .where(eq(subscriberTokens.id, tokenId))
    .run();
}
