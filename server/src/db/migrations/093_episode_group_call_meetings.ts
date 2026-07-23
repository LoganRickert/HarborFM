/**
 * Scheduled episode group-call meetings + invites (reserved join codes/tokens).
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS episode_group_call_meetings (
      id TEXT PRIMARY KEY,
      episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
      podcast_id TEXT NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
      created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      scheduled_start_at TEXT NOT NULL,
      host_time_zone TEXT,
      token TEXT NOT NULL UNIQUE,
      join_code TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'scheduled',
      live_session_id TEXT,
      episode_published_notified_at TEXT,
      ics_sequence INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      cancelled_at TEXT,
      ended_at TEXT
    );
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_egcm_episode_id
      ON episode_group_call_meetings(episode_id);
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_egcm_created_by_status
      ON episode_group_call_meetings(created_by_user_id, status);
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_egcm_join_code
      ON episode_group_call_meetings(join_code);
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_egcm_token
      ON episode_group_call_meetings(token);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS episode_group_call_meeting_invites (
      id TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL REFERENCES episode_group_call_meetings(id) ON DELETE CASCADE,
      email TEXT,
      display_name TEXT,
      invite_token TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_sent_at TEXT
    );
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_egcmi_meeting_id
      ON episode_group_call_meeting_invites(meeting_id);
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_egcmi_invite_token
      ON episode_group_call_meeting_invites(invite_token);
  `);
};

export const down = (db: { exec: (sql: string) => void }) => {
  db.exec(`DROP TABLE IF EXISTS episode_group_call_meeting_invites;`);
  db.exec(`DROP TABLE IF EXISTS episode_group_call_meetings;`);
};
