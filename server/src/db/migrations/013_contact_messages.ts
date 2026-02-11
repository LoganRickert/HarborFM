/**
 * Contact form submissions: name, email, message, created_at.
 * Used to log messages and optionally email admins.
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS contact_messages (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_contact_messages_created_at ON contact_messages(created_at);
  `);
};

export const down = (_db: { exec: (sql: string) => void }) => {};
