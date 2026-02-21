/**
 * Add disabled column to episode_segments. When true, segment is excluded from final episode.
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`ALTER TABLE episode_segments ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0;`);
};

export const down = (_db: { exec: (sql: string) => void }) => {
  // SQLite does not support DROP COLUMN easily; leave column in place on rollback.
};
