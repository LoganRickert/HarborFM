/**
 * Add in_progress and record_failed columns to episode_segments for group call recording durability.
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`
    ALTER TABLE episode_segments ADD COLUMN in_progress INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE episode_segments ADD COLUMN record_failed INTEGER NOT NULL DEFAULT 0;
  `);
};

export const down = (_db: { exec: (sql: string) => void }) => {
  // SQLite does not support DROP COLUMN easily; recreate table would be needed.
  // For simplicity, we leave columns in place on rollback (they default to 0).
};
