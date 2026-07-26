/**
 * Per-job CPU/memory samples reported by compute workers.
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`
    ALTER TABLE worker_job_stats ADD COLUMN avg_cpu_percent REAL;
  `);
  db.exec(`
    ALTER TABLE worker_job_stats ADD COLUMN peak_cpu_percent REAL;
  `);
  db.exec(`
    ALTER TABLE worker_job_stats ADD COLUMN avg_memory_bytes INTEGER;
  `);
  db.exec(`
    ALTER TABLE worker_job_stats ADD COLUMN peak_memory_bytes INTEGER;
  `);
  db.exec(`
    ALTER TABLE worker_job_stats ADD COLUMN resource_sample_count INTEGER;
  `);
  db.exec(`
    ALTER TABLE worker_job_stats ADD COLUMN resource_source TEXT;
  `);
};

export const down = (db: { exec: (sql: string) => void }) => {
  // SQLite cannot drop columns portably before 3.35; leave columns in place.
  void db;
};
