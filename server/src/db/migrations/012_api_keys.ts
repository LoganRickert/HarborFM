/**
 * API keys: users can create up to 5 keys for programmatic access.
 * Keys are stored as SHA-256 hashes; raw key is shown only once on create.
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      key_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_used_at TEXT,
      UNIQUE(user_id, key_hash)
    );
    CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);
    CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash);
  `);
};

export const down = (_db: { exec: (sql: string) => void }) => {};
