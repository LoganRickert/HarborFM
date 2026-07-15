/**
 * Per-show Stripe coupons + redemptions; amount_paid_cents on subscriptions.
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS stripe_coupons (
      id TEXT PRIMARY KEY NOT NULL,
      podcast_id TEXT NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
      mode TEXT NOT NULL DEFAULT 'test',
      code TEXT NOT NULL,
      name TEXT,
      discount_type TEXT NOT NULL,
      percent_off REAL,
      amount_off_cents INTEGER,
      currency TEXT NOT NULL DEFAULT 'usd',
      duration TEXT NOT NULL,
      duration_in_months INTEGER,
      starts_at TEXT,
      ends_at TEXT,
      max_redemptions INTEGER,
      active INTEGER NOT NULL DEFAULT 1,
      stripe_coupon_id TEXT NOT NULL DEFAULT '',
      stripe_promotion_code_id TEXT NOT NULL DEFAULT '',
      sync_error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_stripe_coupons_podcast_id
      ON stripe_coupons(podcast_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_stripe_coupons_podcast_mode_code
      ON stripe_coupons(podcast_id, mode, code);

    CREATE TABLE IF NOT EXISTS stripe_coupon_redemptions (
      id TEXT PRIMARY KEY NOT NULL,
      coupon_id TEXT NOT NULL REFERENCES stripe_coupons(id) ON DELETE CASCADE,
      subscription_id TEXT NOT NULL REFERENCES stripe_subscriptions(id) ON DELETE CASCADE,
      podcast_id TEXT NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
      customer_email TEXT,
      stripe_checkout_session_id TEXT,
      stripe_promotion_code_id TEXT,
      stripe_coupon_id TEXT,
      amount_off_cents INTEGER,
      percent_off REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_stripe_coupon_redemptions_coupon_id
      ON stripe_coupon_redemptions(coupon_id);
    CREATE INDEX IF NOT EXISTS idx_stripe_coupon_redemptions_podcast_id
      ON stripe_coupon_redemptions(podcast_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_stripe_coupon_redemptions_subscription
      ON stripe_coupon_redemptions(subscription_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_stripe_coupon_redemptions_session
      ON stripe_coupon_redemptions(stripe_checkout_session_id)
      WHERE stripe_checkout_session_id IS NOT NULL AND stripe_checkout_session_id != '';

    ALTER TABLE stripe_subscriptions ADD COLUMN amount_paid_cents INTEGER;
  `);
};

export const down = (_db: { exec: (sql: string) => void }) => {};
