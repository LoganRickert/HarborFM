/**
 * Store SAML AuthnRequest IDs for InResponseTo validation.
 * Used by CacheProvider when validateInResponseTo is enabled.
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sso_saml_cache (
      request_id TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_sso_saml_cache_created
      ON sso_saml_cache(created_at);
  `);
};

export const down = (db: { exec: (sql: string) => void }) => {
  db.exec("DROP INDEX IF EXISTS idx_sso_saml_cache_created");
  db.exec("DROP TABLE IF EXISTS sso_saml_cache");
};
