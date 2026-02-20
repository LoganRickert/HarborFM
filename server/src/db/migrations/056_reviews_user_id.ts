/**
 * Add user_id to reviews for logged-in authors. Enables server-side "can delete" (author or admin).
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`
    ALTER TABLE reviews ADD COLUMN user_id TEXT REFERENCES users(id);
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_reviews_user_id ON reviews(user_id);`);
};

export const down = (_db: { exec: (sql: string) => void }) => {
  // SQLite does not support DROP COLUMN easily; leave additive.
};
