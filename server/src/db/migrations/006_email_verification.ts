/**
 * Email verification: allow requiring new users to verify their email before logging in
 * when email is configured. Existing users default to verified (1).
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`
    ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE users ADD COLUMN email_verification_token TEXT;
    ALTER TABLE users ADD COLUMN email_verification_expires_at TEXT;
  `);
};

export const down = (_db: { exec: (sql: string) => void }) => {
  // SQLite does not support DROP COLUMN; migration is additive only.
};
