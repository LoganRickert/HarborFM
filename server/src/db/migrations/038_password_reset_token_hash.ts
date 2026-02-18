/**
 * Password reset: store token_hash (SHA-256) instead of plaintext token.
 * Invalidates any in-flight reset links.
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`DROP TABLE IF EXISTS password_reset_tokens`);

  db.exec(`
    CREATE TABLE password_reset_tokens (
      email TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_email ON password_reset_tokens(email);
    CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token_hash ON password_reset_tokens(token_hash);
  `);
};

export const down = (db: { exec: (sql: string) => void }) => {
  db.exec(`DROP TABLE IF EXISTS password_reset_tokens`);

  db.exec(`
    CREATE TABLE password_reset_tokens (
      email TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_email ON password_reset_tokens(email);
    CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token ON password_reset_tokens(token);
  `);
};
