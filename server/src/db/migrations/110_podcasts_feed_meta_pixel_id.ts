/**
 * Optional Meta Pixel ID for public feed pages (Page Customizations).
 */
import type { Database } from "better-sqlite3";

export const up = (db: Database) => {
  db.exec(`ALTER TABLE podcasts ADD COLUMN feed_meta_pixel_id TEXT;`);
};

export const down = (_db: Database) => {
  // SQLite cannot DROP COLUMN in older versions; leave column in place.
};
