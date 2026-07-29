/**
 * Persist inbound Telnyx dial-in attempts (success and failure) for Settings → WebRTC.
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS dial_in_call_logs (
      id TEXT PRIMARY KEY,
      call_control_id TEXT NOT NULL UNIQUE,
      call_leg_id TEXT,
      call_session_id TEXT,
      connection_id TEXT,
      from_number TEXT,
      to_number TEXT,
      direction TEXT,
      caller_id_name TEXT,
      telnyx_state TEXT,
      outcome TEXT,
      join_code TEXT,
      session_id TEXT,
      episode_id TEXT,
      podcast_id TEXT,
      hangup_cause TEXT,
      sip_hangup_cause TEXT,
      hangup_source TEXT,
      started_at TEXT NOT NULL,
      answered_at TEXT,
      bridged_at TEXT,
      ended_at TEXT,
      duration_ms INTEGER,
      pin_attempts INTEGER NOT NULL DEFAULT 0,
      raw_initiated_json TEXT,
      raw_hangup_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_dial_in_call_logs_created_at
      ON dial_in_call_logs(created_at DESC);
  `);
};

export const down = (db: { exec: (sql: string) => void }) => {
  db.exec(`DROP INDEX IF EXISTS idx_dial_in_call_logs_created_at;`);
  db.exec(`DROP TABLE IF EXISTS dial_in_call_logs;`);
};
