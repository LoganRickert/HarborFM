/**
 * Add loudness_targeting_enabled to episode_segments.
 * When false, Generate Final Episode skips loudnorm for this segment (mixed path).
 * Default 1 (ON) so existing episodes keep current full-mix loudnorm behavior.
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(
    `ALTER TABLE episode_segments ADD COLUMN loudness_targeting_enabled INTEGER NOT NULL DEFAULT 1;`,
  );
};

export const down = (_db: { exec: (sql: string) => void }) => {
  // SQLite does not support DROP COLUMN easily; leave column in place on rollback.
};
