/**
 * Add totp_secret_hash to auth_2fa_challenges for binding TOTP secret to challenge.
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`
    ALTER TABLE auth_2fa_challenges ADD COLUMN totp_secret_hash TEXT;
  `);
};

export const down = (_db: { exec: (sql: string) => void }) => {
  // SQLite does not support DROP COLUMN; column remains
};
