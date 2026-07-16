/**
 * Episode Alerts: podcast flags, destinations, subscribers, episode dedup column.
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`
    ALTER TABLE podcasts ADD COLUMN episode_alerts_enabled INTEGER DEFAULT 0;
    ALTER TABLE podcasts ADD COLUMN episode_alerts_checkout_list TEXT NOT NULL DEFAULT 'subscribers';
    ALTER TABLE podcasts ADD COLUMN episode_alerts_mailing_address TEXT;

    CREATE TABLE IF NOT EXISTS episode_alert_destinations (
      id TEXT PRIMARY KEY NOT NULL,
      podcast_id TEXT NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
      name TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      episode_scope TEXT NOT NULL DEFAULT 'all',
      config TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_episode_alert_destinations_podcast
      ON episode_alert_destinations(podcast_id);

    CREATE TABLE IF NOT EXISTS episode_alert_subscribers (
      id TEXT PRIMARY KEY NOT NULL,
      podcast_id TEXT NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      list TEXT NOT NULL DEFAULT 'general',
      verified INTEGER NOT NULL DEFAULT 0,
      email_verification_token_hash TEXT,
      email_verification_expires_at TEXT,
      unsubscribe_token_hash TEXT,
      source TEXT NOT NULL DEFAULT 'feed',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      verified_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_episode_alert_subscribers_unique
      ON episode_alert_subscribers(podcast_id, email, list);
    CREATE INDEX IF NOT EXISTS idx_episode_alert_subscribers_podcast
      ON episode_alert_subscribers(podcast_id);
    CREATE INDEX IF NOT EXISTS idx_episode_alert_subscribers_verify
      ON episode_alert_subscribers(email_verification_token_hash);
    CREATE INDEX IF NOT EXISTS idx_episode_alert_subscribers_unsub
      ON episode_alert_subscribers(unsubscribe_token_hash);

    ALTER TABLE episodes ADD COLUMN episode_alerts_sent_at TEXT;
  `);
};

export const down = (_db: { exec: (sql: string) => void }) => {};
