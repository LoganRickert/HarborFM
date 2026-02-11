/**
 * Add read_only flag: when set, user cannot create or edit content (podcasts, episodes, library, etc.).
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`
    ALTER TABLE users ADD COLUMN read_only INTEGER NOT NULL DEFAULT 0;
  `);
};

export const down = (_db: { exec: (sql: string) => void }) => {};
