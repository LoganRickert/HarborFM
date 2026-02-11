/**
 * Track platform invites for rate limiting: max N invites per inviter per day.
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS platform_invites (
      inviter_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_platform_invites_inviter_created
      ON platform_invites(inviter_user_id, created_at);
  `);
};

export const down = (db: { exec: (sql: string) => void }) => {
  db.exec(`DROP INDEX IF EXISTS idx_platform_invites_inviter_created;`);
  db.exec(`DROP TABLE IF EXISTS platform_invites;`);
};
