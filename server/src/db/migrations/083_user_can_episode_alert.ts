/**
 * Add can_episode_alert to users. NULL = false (no episode alert permission).
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`ALTER TABLE users ADD COLUMN can_episode_alert INTEGER;`);
};

export const down = (_db: { exec: (sql: string) => void }) => {
  // SQLite does not support DROP COLUMN; migration is additive only.
};
