/**
 * Page customizations: show episode videos on the public feed (default on).
 */
import type { Database } from "better-sqlite3";

export const up = (db: Database) => {
  db.exec(`ALTER TABLE podcasts ADD COLUMN feed_show_videos INTEGER DEFAULT 1;`);
};

export const down = (_db: Database) => {
  // SQLite cannot DROP COLUMN in older versions; leave columns in place.
};
