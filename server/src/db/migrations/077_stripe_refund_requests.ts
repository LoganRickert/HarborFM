/**
 * Listener refund requests for Stripe-paid subscriptions.
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS stripe_refund_requests (
      id TEXT PRIMARY KEY NOT NULL,
      podcast_id TEXT NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
      subscription_id TEXT NOT NULL REFERENCES stripe_subscriptions(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'usd',
      stripe_refund_id TEXT,
      resolved_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_stripe_refund_requests_podcast_id
      ON stripe_refund_requests(podcast_id);
    CREATE INDEX IF NOT EXISTS idx_stripe_refund_requests_subscription_id
      ON stripe_refund_requests(subscription_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_stripe_refund_requests_pending_sub
      ON stripe_refund_requests(subscription_id)
      WHERE status = 'pending';
  `);
};

export const down = (_db: { exec: (sql: string) => void }) => {};
