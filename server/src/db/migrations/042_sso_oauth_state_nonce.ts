/**
 * Add nonce to sso_oauth_state for OIDC ID token validation.
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`
    ALTER TABLE sso_oauth_state ADD COLUMN nonce TEXT;
  `);
};

export const down = (db: { exec: (sql: string) => void }) => {
  // SQLite doesn't support DROP COLUMN easily; recreate table
  db.exec(`
    CREATE TABLE sso_oauth_state_new (
      state TEXT PRIMARY KEY,
      code_verifier TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO sso_oauth_state_new (state, code_verifier, provider_id, created_at)
      SELECT state, code_verifier, provider_id, created_at FROM sso_oauth_state;
    DROP TABLE sso_oauth_state;
    ALTER TABLE sso_oauth_state_new RENAME TO sso_oauth_state;
    CREATE INDEX IF NOT EXISTS idx_sso_oauth_state_created
      ON sso_oauth_state(created_at);
  `);
};
