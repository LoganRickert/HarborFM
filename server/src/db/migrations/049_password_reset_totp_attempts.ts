/**
 * Track failed TOTP attempts during password reset to prevent brute force.
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS password_reset_totp_attempts (
      token_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_password_reset_totp_attempts_token_hash ON password_reset_totp_attempts(token_hash);
  `);
};

export const down = (db: { exec: (sql: string) => void }) => {
  db.exec("DROP TABLE IF EXISTS password_reset_totp_attempts");
};
