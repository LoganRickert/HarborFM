/**
 * Show notes tag (none / discuss / avoid) and submitted_by for guest topic suggestions.
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`
    ALTER TABLE episode_show_notes_items
    ADD COLUMN tag TEXT NOT NULL DEFAULT 'none';

    ALTER TABLE episode_show_notes_items
    ADD COLUMN submitted_by TEXT;
  `);
};

export const down = (db: { exec: (sql: string) => void }) => {
  void db;
};
