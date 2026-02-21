/**
 * Add separate delete token for review delete link so it remains valid after verify-email consumes the verification token.
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`
    ALTER TABLE reviews ADD COLUMN delete_token_hash TEXT;
  `);
  db.exec(`
    ALTER TABLE reviews ADD COLUMN delete_token_expires_at TEXT;
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_reviews_delete_token_hash ON reviews(delete_token_hash);`);
};

export const down = (_db: { exec: (sql: string) => void }) => {
  // SQLite does not support DROP COLUMN easily; leave additive.
};
