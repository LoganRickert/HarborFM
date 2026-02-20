/**
 * Add can_generate_video to users. NULL = false (no video generation permission).
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`ALTER TABLE users ADD COLUMN can_generate_video INTEGER;`);
};

export const down = (_db: { exec: (sql: string) => void }) => {
  // SQLite does not support DROP COLUMN; migration is additive only.
};
