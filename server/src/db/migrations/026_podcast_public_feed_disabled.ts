/**
 * Podcast: public_feed_disabled - when 1, public RSS and public episode list/page do not load (404).
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(
    `ALTER TABLE podcasts ADD COLUMN public_feed_disabled INTEGER DEFAULT 0;`,
  );
};

export const down = (_db: { exec: (sql: string) => void }) => {
  // SQLite does not support DROP COLUMN; migration is additive only.
};
