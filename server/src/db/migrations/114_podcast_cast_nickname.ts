/**
 * Optional short nickname for cast members (used in multi-speaker transcripts).
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`
    ALTER TABLE podcast_cast ADD COLUMN nickname TEXT;
  `);
};

export const down = (db: { exec: (sql: string) => void }) => {
  // SQLite cannot drop columns portably before 3.35; leave columns in place.
  void db;
};
