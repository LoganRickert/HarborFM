/**
 * Podcast: allow_unapproved_reviews (display unapproved), subscriber_only_reviews (only subscribers can submit).
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`ALTER TABLE podcasts ADD COLUMN allow_unapproved_reviews INTEGER DEFAULT 1;`);
  db.exec(`ALTER TABLE podcasts ADD COLUMN subscriber_only_reviews INTEGER DEFAULT 0;`);
};

export const down = (_db: { exec: (sql: string) => void }) => {
  // SQLite does not support DROP COLUMN; migration is additive only.
};
