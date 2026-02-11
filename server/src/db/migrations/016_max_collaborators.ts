/**
 * Per-user and per-podcast collaborator limits. NULL or 0 = no limit.
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`ALTER TABLE users ADD COLUMN max_collaborators INTEGER;`);
  db.exec(`ALTER TABLE podcasts ADD COLUMN max_collaborators INTEGER;`);
};

export const down = (_db: { exec: (sql: string) => void }) => {
  // SQLite does not support DROP COLUMN; migration is additive only.
};
