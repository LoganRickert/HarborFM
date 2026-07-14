/**
 * Podcast 2.0 channel podroll JSON (array of remoteItem-like recommendations).
 */
import type { Database } from "better-sqlite3";

export const up = (db: Database) => {
  db.exec(`ALTER TABLE podcasts ADD COLUMN podroll TEXT;`);
};

export const down = (_db: Database) => {
  // SQLite cannot DROP COLUMN in older versions; leave column in place.
};
