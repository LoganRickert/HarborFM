/**
 * Guest/host episode review tokens (hashed) and one-shot notify stamp on meetings.
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`
    ALTER TABLE episode_group_call_meetings
    ADD COLUMN guest_review_notified_at TEXT;

    CREATE TABLE IF NOT EXISTS episode_guest_reviews (
      id TEXT PRIMARY KEY NOT NULL,
      episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
      meeting_id TEXT REFERENCES episode_group_call_meetings(id) ON DELETE SET NULL,
      email TEXT NOT NULL,
      display_name TEXT,
      token_hash TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending',
      feedback_text TEXT,
      responded_at TEXT,
      last_sent_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      revoked_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_episode_guest_reviews_episode_id
      ON episode_guest_reviews(episode_id);
    CREATE INDEX IF NOT EXISTS idx_episode_guest_reviews_token_hash
      ON episode_guest_reviews(token_hash);
  `);
};

export const down = (db: { exec: (sql: string) => void }) => {
  db.exec(`DROP TABLE IF EXISTS episode_guest_reviews;`);
};
