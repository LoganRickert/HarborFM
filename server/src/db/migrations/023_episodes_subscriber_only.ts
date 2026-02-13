/**
 * Episodes: subscriber_only - when 1, omit from public RSS and lists; include only in tokenized feed.
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`ALTER TABLE episodes ADD COLUMN subscriber_only INTEGER DEFAULT 0;`);
};

export const down = (_db: { exec: (sql: string) => void }) => {
  // SQLite does not support DROP COLUMN; migration is additive only.
};
