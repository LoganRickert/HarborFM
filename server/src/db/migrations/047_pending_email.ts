/**
 * Add pending_email for profile-update email changes that require verification.
 * Email is not updated until user clicks the verification link.
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`
    ALTER TABLE users ADD COLUMN pending_email TEXT;
  `);
};

export const down = () => {
  /* Irreversible - dropping columns in SQLite requires full table recreation */
};
