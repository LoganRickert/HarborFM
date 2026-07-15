
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS stripe_subscriptions (
      id TEXT PRIMARY KEY NOT NULL,
      podcast_id TEXT NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
      stripe_credentials_id TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'test',
      plan_id TEXT,
      subscriber_token_id TEXT REFERENCES subscriber_tokens(id) ON DELETE SET NULL,
      stripe_customer_id TEXT NOT NULL DEFAULT '',
      stripe_subscription_id TEXT,
      stripe_checkout_session_id TEXT,
      stripe_payment_intent_id TEXT,
      status TEXT NOT NULL DEFAULT 'incomplete',
      current_period_end TEXT,
      cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
      customer_email TEXT,
      access_token_enc TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_stripe_subscriptions_podcast_id
      ON stripe_subscriptions(podcast_id);
    CREATE INDEX IF NOT EXISTS idx_stripe_subscriptions_stripe_sub_id
      ON stripe_subscriptions(stripe_subscription_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_stripe_subscriptions_checkout_session
      ON stripe_subscriptions(stripe_checkout_session_id)
      WHERE stripe_checkout_session_id IS NOT NULL AND stripe_checkout_session_id != '';
  `);
};

export const down = (_db: { exec: (sql: string) => void }) => {};
