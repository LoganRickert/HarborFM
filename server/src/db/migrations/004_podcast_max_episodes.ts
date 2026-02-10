/**
 * Per-podcast episode limit. NULL or 0 = no limit.
 * When creating a podcast, max_episodes is copied from the user's default (user.max_episodes).
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`ALTER TABLE podcasts ADD COLUMN max_episodes INTEGER;`);
};

export const down = (_db: { exec: (sql: string) => void }) => {
  // SQLite does not support DROP COLUMN; migration is additive only.
};
