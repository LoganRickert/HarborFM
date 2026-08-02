/**
 * Per-invite open-tracking tokens for meeting invite and reminder emails.
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`
    ALTER TABLE episode_group_call_meeting_invites
    ADD COLUMN invite_open_token TEXT;
    ALTER TABLE episode_group_call_meeting_invites
    ADD COLUMN invite_opened_at TEXT;
    ALTER TABLE episode_group_call_meeting_invites
    ADD COLUMN reminder_open_token TEXT;
    ALTER TABLE episode_group_call_meeting_invites
    ADD COLUMN reminder_opened_at TEXT;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_egcmi_invite_open_token
      ON episode_group_call_meeting_invites(invite_open_token)
      WHERE invite_open_token IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_egcmi_reminder_open_token
      ON episode_group_call_meeting_invites(reminder_open_token)
      WHERE reminder_open_token IS NOT NULL;
  `);
};

export const down = (_db: { exec: (sql: string) => void }) => {
  // SQLite cannot drop columns / partial indexes cleanly here.
};
