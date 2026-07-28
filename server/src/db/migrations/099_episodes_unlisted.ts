/**
 * Episodes: unlisted - when 1, omit from public feed list, RSS, and sitemap;
 * direct episode page and audio still work for scheduled/published.
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`ALTER TABLE episodes ADD COLUMN unlisted INTEGER DEFAULT 0;`);
};

export const down = (_db: { exec: (sql: string) => void }) => {
  // SQLite does not support DROP COLUMN; migration is additive only.
};
