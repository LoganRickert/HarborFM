/**
 * Add can_transcribe to users. NULL = false (no transcription permission).
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`ALTER TABLE users ADD COLUMN can_transcribe INTEGER;`);
};

export const down = (_db: { exec: (sql: string) => void }) => {
  // SQLite does not support DROP COLUMN; migration is additive only.
};
