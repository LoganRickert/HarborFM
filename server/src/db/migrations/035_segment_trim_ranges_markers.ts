/**
 * Add trim_ranges and markers columns to episode_segments for non-destructive timeline editing.
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`
    ALTER TABLE episode_segments ADD COLUMN trim_ranges TEXT;
    ALTER TABLE episode_segments ADD COLUMN markers TEXT;
  `);
};

export const down = (_db: { exec: (sql: string) => void }) => {
  // SQLite does not support DROP COLUMN easily; leave columns in place on rollback.
};
