/**
 * Two-factor authentication: users columns, OTP codes, challenges, TOTP attempts.
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`
    ALTER TABLE users ADD COLUMN totp_secret_enc TEXT;
  `);
  db.exec(`
    ALTER TABLE users ADD COLUMN two_factor_method TEXT;
  `);
  db.exec(`
    ALTER TABLE users ADD COLUMN totp_locked_until TEXT;
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS user_otp_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_user_otp_codes_user_id ON user_otp_codes(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_otp_codes_expires_at ON user_otp_codes(expires_at);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS auth_2fa_challenges (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      method TEXT NOT NULL CHECK (method IN ('totp', 'email')),
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_auth_2fa_challenges_token_hash ON auth_2fa_challenges(token_hash);
    CREATE INDEX IF NOT EXISTS idx_auth_2fa_challenges_expires_at ON auth_2fa_challenges(expires_at);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS user_totp_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_user_totp_attempts_user_created ON user_totp_attempts(user_id, created_at);
  `);
};

export const down = (db: { exec: (sql: string) => void }) => {
  db.exec(`DROP TABLE IF EXISTS user_totp_attempts;`);
  db.exec(`DROP TABLE IF EXISTS auth_2fa_challenges;`);
  db.exec(`DROP TABLE IF EXISTS user_otp_codes;`);
  // SQLite does not support DROP COLUMN easily; totp_secret_enc, two_factor_method, totp_locked_until remain on users.
};
