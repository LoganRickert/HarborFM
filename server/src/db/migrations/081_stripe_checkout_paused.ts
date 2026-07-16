/**
 * Show-level flag to block new Stripe Checkouts while keeping Payments UI editable.
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`
    ALTER TABLE podcasts ADD COLUMN stripe_checkout_paused INTEGER DEFAULT 0;
  `);
};

export const down = (_db: { exec: (sql: string) => void }) => {};
