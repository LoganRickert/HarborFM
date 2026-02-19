/**
 * Add profile_email_username_updated_at for 5-minute rate limit on email/username changes.
 * Leave username blank (NULL) for users where username = email (legacy copy from 040).
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`
    ALTER TABLE users ADD COLUMN profile_email_username_updated_at TEXT;
  `);
  db.exec(`
    UPDATE users SET username = NULL
    WHERE username IS NOT NULL AND email IS NOT NULL
      AND LOWER(TRIM(username)) = LOWER(TRIM(email));
  `);
};

export const down = () => {
  /* Irreversible - dropping columns in SQLite requires full table recreation */
};
