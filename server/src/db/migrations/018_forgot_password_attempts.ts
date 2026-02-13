/**
 * Forgot-password rate limit: record attempt per email so we apply the same
 * cooldown whether the account exists or not (prevents email enumeration).
 * Stores IP and user agent for auditing.
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS forgot_password_attempts (
      email TEXT NOT NULL PRIMARY KEY,
      attempted_at TEXT NOT NULL,
      ip TEXT,
      user_agent TEXT
    );
  `);
};

export const down = (_db: { exec: (sql: string) => void }) => {};
