/**
 * Page customizations for public feed: accent color + visibility toggles.
 */
import type { Database } from "better-sqlite3";

export const up = (db: Database) => {
  db.exec(`ALTER TABLE podcasts ADD COLUMN feed_accent TEXT DEFAULT 'green';`);
  db.exec(
    `ALTER TABLE podcasts ADD COLUMN feed_show_podcast_description INTEGER DEFAULT 1;`,
  );
  db.exec(
    `ALTER TABLE podcasts ADD COLUMN feed_show_episode_description INTEGER DEFAULT 1;`,
  );
  db.exec(`ALTER TABLE podcasts ADD COLUMN feed_show_funding INTEGER DEFAULT 1;`);
  db.exec(
    `ALTER TABLE podcasts ADD COLUMN feed_show_reviews_podcast INTEGER DEFAULT 1;`,
  );
  db.exec(
    `ALTER TABLE podcasts ADD COLUMN feed_show_reviews_episode INTEGER DEFAULT 1;`,
  );
};

export const down = (_db: Database) => {
  // SQLite cannot DROP COLUMN in older versions; leave columns in place.
};
