/**
 * One-time reveal of Stripe access tokens on checkout success.
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`
    ALTER TABLE stripe_subscriptions ADD COLUMN access_token_revealed_at TEXT;
  `);
};
