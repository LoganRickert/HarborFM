/**
 * Password reset: tokens for forgot-password flow (rate-limited, expiry).
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      email TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_email ON password_reset_tokens(email);
    CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token ON password_reset_tokens(token);
  `);
};

export const down = (_db: { exec: (sql: string) => void }) => {
  // SQLite: drop table if needed for rollback (not implemented for simplicity)
};
