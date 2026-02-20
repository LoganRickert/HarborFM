/**
 * Reviews table: podcast and episode reviews with verification and moderation flags.
 * One review per email per podcast (episode_id NULL); one per email per episode (episode_id set). Enforced in app.
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      podcast_id TEXT NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
      episode_id TEXT REFERENCES episodes(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      rating INTEGER NOT NULL,
      body TEXT NOT NULL,
      verified INTEGER NOT NULL DEFAULT 0,
      approved INTEGER NOT NULL DEFAULT 0,
      spam INTEGER NOT NULL DEFAULT 0,
      hidden INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      email_verification_token_hash TEXT,
      email_verification_expires_at TEXT
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_reviews_podcast_id ON reviews(podcast_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_reviews_episode_id ON reviews(episode_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_reviews_created_at ON reviews(created_at);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_reviews_email_verification_token_hash ON reviews(email_verification_token_hash);`);
};

export const down = (_db: { exec: (sql: string) => void }) => {
  // SQLite: would need to DROP TABLE reviews; leave additive for safety.
};
