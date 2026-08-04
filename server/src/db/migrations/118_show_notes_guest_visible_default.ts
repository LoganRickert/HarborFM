/**
 * Show notes are shared with call guests by default.
 * Flip existing episodes that were still on the old host-only default.
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`
    UPDATE episodes SET show_notes_guest_visible = 1 WHERE show_notes_guest_visible = 0;
  `);
};

export const down = (db: { exec: (sql: string) => void }) => {
  void db;
};
