/**
 * Page customizations: author, recommended podcasts (podroll), and cast visibility.
 */
import type { Database } from "better-sqlite3";

export const up = (db: Database) => {
  db.exec(`ALTER TABLE podcasts ADD COLUMN feed_show_author INTEGER DEFAULT 1;`);
  db.exec(`ALTER TABLE podcasts ADD COLUMN feed_show_podroll INTEGER DEFAULT 1;`);
  db.exec(`ALTER TABLE podcasts ADD COLUMN feed_show_cast INTEGER DEFAULT 1;`);
};

export const down = (_db: Database) => {
  // SQLite cannot DROP COLUMN in older versions; leave columns in place.
};
