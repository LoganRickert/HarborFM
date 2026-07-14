/**
 * Add content_links column to episodes. JSON array of Podcast 2.0 content links
 * { href, text? } emitted as <podcast:contentLink href="...">text</podcast:contentLink>.
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`ALTER TABLE episodes ADD COLUMN content_links TEXT;`);
};

export const down = (_db: { exec: (sql: string) => void }) => {
  // SQLite does not support DROP COLUMN easily; leave column in place on rollback.
};
