/**
 * Page themes: feed_theme on podcasts, feed_themes packages, can_import_theme on users.
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`ALTER TABLE podcasts ADD COLUMN feed_theme TEXT DEFAULT 'default';`);
  db.exec(`ALTER TABLE users ADD COLUMN can_import_theme INTEGER;`);
  db.exec(`
    CREATE TABLE IF NOT EXISTS feed_themes (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      package_id TEXT NOT NULL,
      name TEXT NOT NULL,
      version TEXT NOT NULL,
      byte_size INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (owner_user_id, package_id)
    );
    CREATE INDEX IF NOT EXISTS idx_feed_themes_owner ON feed_themes(owner_user_id);
  `);
};

export const down = (_db: { exec: (sql: string) => void }) => {
  // SQLite: additive only
};
