/**
 * User limit: max_subscriber_tokens per podcast. NULL or 0 = no limit / use default.
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`ALTER TABLE users ADD COLUMN max_subscriber_tokens INTEGER;`);
};

export const down = (_db: { exec: (sql: string) => void }) => {
  // SQLite does not support DROP COLUMN; migration is additive only.
};
