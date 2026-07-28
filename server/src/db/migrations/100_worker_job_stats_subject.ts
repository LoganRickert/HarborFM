/**
 * Persist podcast/episode subject and requesting user on worker job stats
 * for the admin Recent jobs UI.
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`
    ALTER TABLE worker_job_stats ADD COLUMN podcast_id TEXT;
  `);
  db.exec(`
    ALTER TABLE worker_job_stats ADD COLUMN episode_id TEXT;
  `);
  db.exec(`
    ALTER TABLE worker_job_stats ADD COLUMN segment_id TEXT;
  `);
  db.exec(`
    ALTER TABLE worker_job_stats ADD COLUMN podcast_title TEXT;
  `);
  db.exec(`
    ALTER TABLE worker_job_stats ADD COLUMN episode_title TEXT;
  `);
  db.exec(`
    ALTER TABLE worker_job_stats ADD COLUMN user_id TEXT;
  `);
  db.exec(`
    ALTER TABLE worker_job_stats ADD COLUMN user_email TEXT;
  `);
  db.exec(`
    ALTER TABLE worker_job_stats ADD COLUMN user_username TEXT;
  `);
};

export const down = (db: { exec: (sql: string) => void }) => {
  // SQLite cannot drop columns portably before 3.35; leave columns in place.
  void db;
};
