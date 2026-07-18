/**
 * Episode expiration: expires_at on episodes; subscribers_keep_expired_episodes on podcasts.
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`
    ALTER TABLE episodes ADD COLUMN expires_at TEXT;
    CREATE INDEX IF NOT EXISTS idx_episodes_expires_at ON episodes(expires_at);
    ALTER TABLE podcasts ADD COLUMN subscribers_keep_expired_episodes INTEGER NOT NULL DEFAULT 0;
  `);
};

export const down = (_db: { exec: (sql: string) => void }) => {
  // SQLite does not support DROP COLUMN; migration is additive only.
};
