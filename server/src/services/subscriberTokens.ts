import { db } from "../db/index.js";
import { sha256Hex } from "../utils/hash.js";

export interface SubscriberTokenRow {
  id: string;
  podcast_id: string;
  name: string;
  token_hash: string;
  valid_from: string | null;
  valid_until: string | null;
  disabled: number;
  created_at: string;
  last_used_at: string | null;
}

export interface ValidateSubscriberTokenResult {
  tokenExists: boolean;
  row: SubscriberTokenRow | null;
}

/**
 * Validate subscriber token with existence distinction: unknown hash vs exists but disabled/expired.
 * - tokenExists: false, row: null → hash not in DB (caller may record bad attempt and ban).
 * - tokenExists: true, row: null → hash exists but disabled/expired/invalid (reject without recording).
 * - tokenExists: true, row → valid token.
 */
export function validateSubscriberTokenByValueWithExistence(
  rawToken: string,
): ValidateSubscriberTokenResult {
  if (!rawToken || typeof rawToken !== "string" || !rawToken.trim())
    return { tokenExists: false, row: null };
  const tokenHash = sha256Hex(rawToken.trim());
  const rowByHash = db
    .prepare(
      `SELECT st.id, st.podcast_id, st.name, st.token_hash, st.valid_from, st.valid_until,
        COALESCE(st.disabled, 0) AS disabled, st.created_at, st.last_used_at
       FROM subscriber_tokens st
       JOIN podcasts p ON p.id = st.podcast_id
       JOIN users u ON u.id = p.owner_user_id
       WHERE st.token_hash = ? AND COALESCE(st.disabled, 0) = 0 AND COALESCE(u.disabled, 0) = 0`,
    )
    .get(tokenHash) as SubscriberTokenRow | undefined;
  if (!rowByHash) {
    const anyRow = db
      .prepare("SELECT 1 FROM subscriber_tokens WHERE token_hash = ?")
      .get(tokenHash);
    return {
      tokenExists: Boolean(anyRow),
      row: null,
    };
  }
  const now = new Date().toISOString();
  if (rowByHash.valid_from && rowByHash.valid_from > now)
    return { tokenExists: true, row: null };
  if (rowByHash.valid_until && rowByHash.valid_until < now)
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
  const row = db
    .prepare(
      `SELECT st.id, st.podcast_id, st.name, st.token_hash, st.valid_from, st.valid_until,
        COALESCE(st.disabled, 0) AS disabled, st.created_at, st.last_used_at
       FROM subscriber_tokens st
       JOIN podcasts p ON p.id = st.podcast_id
       JOIN users u ON u.id = p.owner_user_id
       WHERE st.id = ? AND st.podcast_id = ? AND COALESCE(st.disabled, 0) = 0 AND COALESCE(u.disabled, 0) = 0`,
    )
    .get(tokenId.trim(), podcastId.trim()) as SubscriberTokenRow | undefined;
  if (!row) return null;
  const now = new Date().toISOString();
  if (row.valid_from && row.valid_from > now) return null;
  if (row.valid_until && row.valid_until < now) return null;
  return row;
}

/** Update last_used_at for a token (by id). */
export function touchSubscriberToken(tokenId: string): void {
  db.prepare(
    "UPDATE subscriber_tokens SET last_used_at = datetime('now') WHERE id = ?",
  ).run(tokenId);
}
