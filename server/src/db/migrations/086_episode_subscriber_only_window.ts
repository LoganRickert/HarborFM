/**
 * Episode subscriber-only window: optional starts_at / ends_at when subscriber_only is on.
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`
    ALTER TABLE episodes ADD COLUMN subscriber_only_starts_at TEXT;
    ALTER TABLE episodes ADD COLUMN subscriber_only_ends_at TEXT;
    CREATE INDEX IF NOT EXISTS idx_episodes_subscriber_only_starts_at
      ON episodes(subscriber_only_starts_at);
    CREATE INDEX IF NOT EXISTS idx_episodes_subscriber_only_ends_at
      ON episodes(subscriber_only_ends_at);
  `);
};

export const down = (_db: { exec: (sql: string) => void }) => {
  // SQLite does not support DROP COLUMN; migration is additive only.
};
