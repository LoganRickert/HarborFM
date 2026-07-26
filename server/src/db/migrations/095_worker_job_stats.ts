/**
 * Per-job history for remote compute workers (duration, bytes, worker name).
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS worker_job_stats (
      id TEXT PRIMARY KEY,
      worker_id TEXT,
      worker_name TEXT,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      error TEXT,
      bytes_downloaded INTEGER NOT NULL DEFAULT 0,
      bytes_uploaded INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_worker_job_stats_created_at
      ON worker_job_stats(created_at DESC);
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_worker_job_stats_worker_name_created
      ON worker_job_stats(worker_name, created_at DESC);
  `);
};

export const down = (db: { exec: (sql: string) => void }) => {
  db.exec(`DROP INDEX IF EXISTS idx_worker_job_stats_worker_name_created;`);
  db.exec(`DROP INDEX IF EXISTS idx_worker_job_stats_created_at;`);
  db.exec(`DROP TABLE IF EXISTS worker_job_stats;`);
};
