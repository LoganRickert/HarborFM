/**
 * Store SAML RelayState for CSRF/replay protection.
 * RelayState is generated on initiate, validated on callback (single-use + expiry).
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sso_saml_state (
      relay_state TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_sso_saml_state_created
      ON sso_saml_state(created_at);
  `);
};

export const down = (db: { exec: (sql: string) => void }) => {
  db.exec("DROP INDEX IF EXISTS idx_sso_saml_state_created");
  db.exec("DROP TABLE IF EXISTS sso_saml_state");
};
