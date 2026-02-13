/**
 * Subscriber tokens: per-podcast tokenized RSS access. Token stored as hash; raw shown once on create.
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS subscriber_tokens (
      id TEXT PRIMARY KEY,
      podcast_id TEXT NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      valid_from TEXT,
      valid_until TEXT,
      disabled INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_used_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_subscriber_tokens_podcast_id ON subscriber_tokens(podcast_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriber_tokens_token_hash ON subscriber_tokens(token_hash);
  `);
};

export const down = (_db: { exec: (sql: string) => void }) => {};
