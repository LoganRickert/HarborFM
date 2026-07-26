/**
 * One-shot 4-hour reminder email flag for scheduled group-call meetings.
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`
    ALTER TABLE episode_group_call_meetings
    ADD COLUMN reminder_sent_at TEXT;
  `);
};

export const down = (db: { exec: (sql: string) => void }) => {
  void db;
};
