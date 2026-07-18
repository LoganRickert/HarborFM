/**
 * Episode Files: listener-facing attachments (uploads + links) per episode.
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS episode_files (
      id TEXT PRIMARY KEY,
      episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      storage_name TEXT,
      mime_type TEXT,
      byte_size INTEGER,
      original_filename TEXT,
      url TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_episode_files_episode_sort
      ON episode_files(episode_id, sort_order);
  `);
};

export const down = (_db: { exec: (sql: string) => void }) => {
  // SQLite: additive only
};
