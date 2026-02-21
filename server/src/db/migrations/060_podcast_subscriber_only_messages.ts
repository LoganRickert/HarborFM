/**
 * Podcast: subscriber_only_messages (only subscribers can see/use Message button and submit contact for this show).
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`ALTER TABLE podcasts ADD COLUMN subscriber_only_messages INTEGER DEFAULT 0;`);
};

export const down = (_db: { exec: (sql: string) => void }) => {
  // SQLite does not support DROP COLUMN; migration is additive only.
};
