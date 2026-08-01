/**
 * Podcast archive destination (1:1) and episode archive metadata.
 * Archive Settings store one remote destination per podcast; archived episodes
 * keep feed-serving files and record remote zip location for restore.
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS podcast_archive_settings (
      podcast_id TEXT PRIMARY KEY NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'S3',
      config_enc TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    ALTER TABLE episodes ADD COLUMN archived_at TEXT;
    ALTER TABLE episodes ADD COLUMN archive_remote_path TEXT;
    ALTER TABLE episodes ADD COLUMN archive_sha256 TEXT;
    ALTER TABLE episodes ADD COLUMN archive_bytes INTEGER;
    ALTER TABLE episodes ADD COLUMN archive_filename TEXT;
  `);
};

export const down = (db: { exec: (sql: string) => void }) => {
  db.exec(`DROP TABLE IF EXISTS podcast_archive_settings;`);
  // SQLite does not support DROP COLUMN for episodes archive fields.
};
