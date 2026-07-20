/**
 * Server-wide themes: scope + nullable owner_user_id so bundled themes are DB rows
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`
    CREATE TABLE feed_themes_new (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      scope TEXT NOT NULL DEFAULT 'user',
      package_id TEXT NOT NULL,
      name TEXT NOT NULL,
      version TEXT NOT NULL,
      byte_size INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      CHECK (scope IN ('user', 'server')),
      CHECK (
        (scope = 'server' AND owner_user_id IS NULL)
        OR (scope = 'user' AND owner_user_id IS NOT NULL)
      )
    );
  `);
  db.exec(`
    INSERT INTO feed_themes_new (
      id, owner_user_id, scope, package_id, name, version, byte_size, created_at, updated_at
    )
    SELECT
      id, owner_user_id, 'user', package_id, name, version, byte_size, created_at, updated_at
    FROM feed_themes;
  `);
  db.exec(`DROP TABLE feed_themes;`);
  db.exec(`ALTER TABLE feed_themes_new RENAME TO feed_themes;`);
  db.exec(`
    CREATE UNIQUE INDEX feed_themes_user_package
      ON feed_themes(owner_user_id, package_id)
      WHERE scope = 'user';
  `);
  db.exec(`
    CREATE UNIQUE INDEX feed_themes_server_package
      ON feed_themes(package_id)
      WHERE scope = 'server';
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_feed_themes_owner ON feed_themes(owner_user_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_feed_themes_scope ON feed_themes(scope);`);
};

export const down = (_db: { exec: (sql: string) => void }) => {
  // SQLite: additive only
};
