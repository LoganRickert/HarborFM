/**
 * Add can_stripe to users. NULL = false (no Stripe / paid subscriptions permission).
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`ALTER TABLE users ADD COLUMN can_stripe INTEGER;`);
};

export const down = (_db: { exec: (sql: string) => void }) => {
  // SQLite does not support DROP COLUMN; migration is additive only.
};
