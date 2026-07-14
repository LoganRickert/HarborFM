/**
 * Episode polls: one poll per episode (settings + questions JSON), submissions, and answers.
 * Survives episode rebuild (not touched by updateEpisodeAfterRender).
 */
import type { Database } from "better-sqlite3";

export const up = (db: Database) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS episode_polls (
      id TEXT PRIMARY KEY,
      episode_id TEXT NOT NULL UNIQUE REFERENCES episodes(id) ON DELETE CASCADE,
      enabled INTEGER NOT NULL DEFAULT 0,
      start_at TEXT,
      end_at TEXT,
      require_email INTEGER NOT NULL DEFAULT 0,
      public_results INTEGER NOT NULL DEFAULT 0,
      limit_one_vote_per_ip INTEGER NOT NULL DEFAULT 0,
      questions_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_episode_polls_episode_id ON episode_polls(episode_id);`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS episode_poll_submissions (
      id TEXT PRIMARY KEY,
      poll_id TEXT NOT NULL REFERENCES episode_polls(id) ON DELETE CASCADE,
      episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
      email TEXT,
      email_normalized TEXT,
      verified INTEGER NOT NULL DEFAULT 0,
      email_verification_token_hash TEXT,
      email_verification_expires_at TEXT,
      ip_hash TEXT,
      client_key TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_episode_poll_submissions_poll_id ON episode_poll_submissions(poll_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_episode_poll_submissions_episode_id ON episode_poll_submissions(episode_id);`);
  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_episode_poll_submissions_poll_email ON episode_poll_submissions(poll_id, email_normalized) WHERE email_normalized IS NOT NULL AND email_normalized != '';`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_episode_poll_submissions_poll_ip ON episode_poll_submissions(poll_id, ip_hash);`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_episode_poll_submissions_verify_token ON episode_poll_submissions(email_verification_token_hash);`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_episode_poll_submissions_client_key ON episode_poll_submissions(poll_id, client_key);`,
  );

  db.exec(`
    CREATE TABLE IF NOT EXISTS episode_poll_answers (
      id TEXT PRIMARY KEY,
      submission_id TEXT NOT NULL REFERENCES episode_poll_submissions(id) ON DELETE CASCADE,
      question_id TEXT NOT NULL,
      option_id TEXT,
      text_value TEXT
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_episode_poll_answers_submission_id ON episode_poll_answers(submission_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_episode_poll_answers_question_id ON episode_poll_answers(question_id);`);
};

export const down = (_db: Database) => {
  // Additive migration; leave tables in place for safety.
};
