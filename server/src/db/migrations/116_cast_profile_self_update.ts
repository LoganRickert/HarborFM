/**
 * Cast profile self-update invite tokens and pending proposals.
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS podcast_cast_profile_tokens (
      id TEXT PRIMARY KEY NOT NULL,
      podcast_id TEXT NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
      cast_id TEXT NOT NULL REFERENCES podcast_cast(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      revoked_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_cast_profile_tokens_cast_id
      ON podcast_cast_profile_tokens(cast_id);
    CREATE INDEX IF NOT EXISTS idx_cast_profile_tokens_token_hash
      ON podcast_cast_profile_tokens(token_hash);
    CREATE INDEX IF NOT EXISTS idx_cast_profile_tokens_podcast_id
      ON podcast_cast_profile_tokens(podcast_id);

    CREATE TABLE IF NOT EXISTS podcast_cast_profile_pending (
      cast_id TEXT PRIMARY KEY NOT NULL REFERENCES podcast_cast(id) ON DELETE CASCADE,
      podcast_id TEXT NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      nickname TEXT,
      description TEXT,
      social_links TEXT NOT NULL DEFAULT '[]',
      photo_path TEXT,
      submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_cast_profile_pending_podcast_id
      ON podcast_cast_profile_pending(podcast_id);
  `);
};

export const down = (db: { exec: (sql: string) => void }) => {
  db.exec(`
    DROP TABLE IF EXISTS podcast_cast_profile_pending;
    DROP TABLE IF EXISTS podcast_cast_profile_tokens;
  `);
};
