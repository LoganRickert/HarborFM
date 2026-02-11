/**
 * Podcast sharing: users can be granted view/editor/manager access via podcast_shares.
 * Roles stored as TEXT for extensibility.
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS podcast_shares (
      podcast_id TEXT NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(podcast_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_podcast_shares_user_id ON podcast_shares(user_id);
  `);
};

export const down = (db: { exec: (sql: string) => void }) => {
  db.exec(`DROP INDEX IF EXISTS idx_podcast_shares_user_id;`);
  db.exec(`DROP TABLE IF EXISTS podcast_shares;`);
};
