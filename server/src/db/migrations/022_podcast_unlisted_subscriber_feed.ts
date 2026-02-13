/**
 * Podcast: unlisted (exclude from /feed and sitemap), subscriber-only feed enabled, max_subscriber_tokens override.
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`ALTER TABLE podcasts ADD COLUMN unlisted INTEGER DEFAULT 0;`);
  db.exec(
    `ALTER TABLE podcasts ADD COLUMN subscriber_only_feed_enabled INTEGER DEFAULT 0;`,
  );
  db.exec(`ALTER TABLE podcasts ADD COLUMN max_subscriber_tokens INTEGER;`);
};

export const down = (_db: { exec: (sql: string) => void }) => {
  // SQLite does not support DROP COLUMN; migration is additive only.
};
