/**
 * Add final_soundbites column to episodes. JSON array of soundbite markers
 * { time, duration, title?, color? } copied from segments during render.
 * Time/duration are in seconds of final audio; duration is 15–120.
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`ALTER TABLE episodes ADD COLUMN final_soundbites TEXT;`);
};

export const down = (_db: { exec: (sql: string) => void }) => {
  // SQLite does not support DROP COLUMN easily; leave column in place on rollback.
};
