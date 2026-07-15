/**
 * Per-show Stripe plans (Products/Prices) + billing_anchor on podcasts.
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS stripe_plans (
      id TEXT PRIMARY KEY NOT NULL,
      podcast_id TEXT NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
      mode TEXT NOT NULL DEFAULT 'test',
      kind TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'usd',
      active INTEGER NOT NULL DEFAULT 1,
      stripe_product_id TEXT NOT NULL DEFAULT '',
      stripe_price_id TEXT NOT NULL DEFAULT '',
      auto_renew_default INTEGER NOT NULL DEFAULT 1,
      sync_error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_stripe_plans_podcast_id ON stripe_plans(podcast_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_stripe_plans_podcast_mode_kind
      ON stripe_plans(podcast_id, mode, kind);

    ALTER TABLE podcasts ADD COLUMN billing_anchor TEXT NOT NULL DEFAULT 'anniversary';
  `);
};

export const down = (_db: { exec: (sql: string) => void }) => {};
