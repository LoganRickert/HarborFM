/**
 * Add final_markers column to episodes. JSON array of chapter markers { time, title?, color? }
 * copied from segments during render. Time is in seconds of final audio.
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`ALTER TABLE episodes ADD COLUMN final_markers TEXT;`);
};

export const down = (_db: { exec: (sql: string) => void }) => {
  // SQLite does not support DROP COLUMN easily; leave column in place on rollback.
};
