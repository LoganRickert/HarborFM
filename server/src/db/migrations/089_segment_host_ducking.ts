/**
 * Add host_ducking_enabled to episode_segments.
 * When true, exclusive host gates from host_ducking.json are applied on remake.
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(
    `ALTER TABLE episode_segments ADD COLUMN host_ducking_enabled INTEGER NOT NULL DEFAULT 0;`,
  );
};

export const down = (_db: { exec: (sql: string) => void }) => {
  // SQLite does not support DROP COLUMN easily; leave column in place on rollback.
};
