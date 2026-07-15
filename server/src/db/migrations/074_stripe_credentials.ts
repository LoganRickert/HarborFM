/**
 * Per-user shareable Stripe credential packs + podcast link columns.
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS stripe_credentials (
      id TEXT PRIMARY KEY NOT NULL,
      owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      display_name TEXT NOT NULL DEFAULT '',
      mode TEXT NOT NULL DEFAULT 'test',
      test_secret_key_enc TEXT,
      test_publishable_key_enc TEXT,
      test_webhook_secret_enc TEXT,
      live_secret_key_enc TEXT,
      live_publishable_key_enc TEXT,
      live_webhook_secret_enc TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_stripe_credentials_owner_user_id
      ON stripe_credentials(owner_user_id);

    ALTER TABLE podcasts ADD COLUMN stripe_credentials_id TEXT
      REFERENCES stripe_credentials(id) ON DELETE SET NULL;
    ALTER TABLE podcasts ADD COLUMN stripe_payments_enabled INTEGER DEFAULT 0;
  `);
};

export const down = (_db: { exec: (sql: string) => void }) => {};
