/**
 * Private invite email for show cast members (not exposed on public feeds).
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`
    ALTER TABLE podcast_cast ADD COLUMN email TEXT;
  `);
};

export const down = (db: { exec: (sql: string) => void }) => {
  // SQLite cannot drop columns portably before 3.35; leave columns in place.
  void db;
};
