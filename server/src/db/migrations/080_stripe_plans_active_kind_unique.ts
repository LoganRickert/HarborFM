/**
 * Allow multiple plans per kind when inactive; only one active plan per kind/mode.
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`
    DROP INDEX IF EXISTS idx_stripe_plans_podcast_mode_kind;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_stripe_plans_podcast_mode_kind_active
      ON stripe_plans(podcast_id, mode, kind)
      WHERE active = 1;
  `);
};
