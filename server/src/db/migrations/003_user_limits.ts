/**
 * User limits: max_podcasts, max_storage_mb, max_episodes.
 * NULL or 0 means no limit / infinity.
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`
    ALTER TABLE users ADD COLUMN max_podcasts INTEGER;
    ALTER TABLE users ADD COLUMN max_storage_mb INTEGER;
    ALTER TABLE users ADD COLUMN max_episodes INTEGER;
  `);
};

export const down = (_db: { exec: (sql: string) => void }) => {
  // SQLite does not support DROP COLUMN; migration is additive only.
};
