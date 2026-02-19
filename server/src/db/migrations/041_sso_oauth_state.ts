/**
 * Store OIDC state and code_verifier for PKCE between initiate and callback.
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sso_oauth_state (
      state TEXT PRIMARY KEY,
      code_verifier TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_sso_oauth_state_created
      ON sso_oauth_state(created_at);
  `);
};

export const down = (db: { exec: (sql: string) => void }) => {
  db.exec("DROP INDEX IF EXISTS idx_sso_oauth_state_created");
  db.exec("DROP TABLE IF EXISTS sso_oauth_state");
};
