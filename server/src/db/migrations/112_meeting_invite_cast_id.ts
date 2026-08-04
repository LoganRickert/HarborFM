/**
 * Optional cast member link on meeting invites (for roster avatars).
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`
    ALTER TABLE episode_group_call_meeting_invites
    ADD COLUMN cast_id TEXT REFERENCES podcast_cast(id) ON DELETE SET NULL;

    CREATE INDEX IF NOT EXISTS idx_egcmi_cast_id
      ON episode_group_call_meeting_invites(cast_id);
  `);
};

export const down = (_db: { exec: (sql: string) => void }) => {
  // SQLite cannot drop columns cleanly here.
};
