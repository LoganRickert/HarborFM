/**
 * Instance-wide theme catalog destinations (admin-managed catalog.json URLs).
 * `name` is an admin-chosen label shown in Explore Themes (not taken from catalog.json).
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS theme_catalog_destinations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS theme_catalog_destinations_url
      ON theme_catalog_destinations(url);
  `);
};

export const down = (db: { exec: (sql: string) => void }) => {
  db.exec(`DROP TABLE IF EXISTS theme_catalog_destinations;`);
};
