/**
 * Track whether a Stripe credential pack passed key verification.
 * Existing packs default to verified so current installs keep working.
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`
    ALTER TABLE stripe_credentials ADD COLUMN verified INTEGER NOT NULL DEFAULT 1;
  `);
};

export const down = (_db: { exec: (sql: string) => void }) => {};
