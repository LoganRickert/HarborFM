/**
 * Add audio_eq column to episode_segments for per-segment 3-band EQ (low/mids/high in dB).
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`ALTER TABLE episode_segments ADD COLUMN audio_eq TEXT;`);
};

export const down = (_db: { exec: (sql: string) => void }) => {
  // SQLite does not support DROP COLUMN easily; leave column in place on rollback.
};
