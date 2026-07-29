/**
 * Add final_gain_db to episode_segments.
 * Fixed dB gain applied on Generate Final Episode (after trim/EQ, before loudnorm).
 * Default 0 so existing episodes are unchanged.
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(
    `ALTER TABLE episode_segments ADD COLUMN final_gain_db REAL NOT NULL DEFAULT 0;`,
  );
};

export const down = (_db: { exec: (sql: string) => void }) => {
  // SQLite does not support DROP COLUMN easily; leave column in place on rollback.
};
