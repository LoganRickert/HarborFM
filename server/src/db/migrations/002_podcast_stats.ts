/**
 * Podcast statistics: daily aggregates for RSS hits, episode requests,
 * episode requests by location, and episode listens (with dedup).
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS podcast_stats_rss_daily (
      podcast_id TEXT NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
      stat_date TEXT NOT NULL,
      bot_count INTEGER NOT NULL DEFAULT 0,
      human_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (podcast_id, stat_date)
    );

    CREATE TABLE IF NOT EXISTS podcast_stats_episode_daily (
      episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
      stat_date TEXT NOT NULL,
      bot_count INTEGER NOT NULL DEFAULT 0,
      human_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (episode_id, stat_date)
    );

    CREATE TABLE IF NOT EXISTS podcast_stats_episode_location_daily (
      episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
      stat_date TEXT NOT NULL,
      location TEXT NOT NULL,
      bot_count INTEGER NOT NULL DEFAULT 0,
      human_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (episode_id, stat_date, location)
    );

    CREATE TABLE IF NOT EXISTS podcast_stats_episode_listens_daily (
      episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
      stat_date TEXT NOT NULL,
      bot_count INTEGER NOT NULL DEFAULT 0,
      human_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (episode_id, stat_date)
    );

    CREATE TABLE IF NOT EXISTS podcast_stats_listen_dedup (
      episode_id TEXT NOT NULL,
      stat_date TEXT NOT NULL,
      client_key TEXT NOT NULL,
      PRIMARY KEY (episode_id, stat_date, client_key)
    );

    CREATE INDEX IF NOT EXISTS idx_podcast_stats_listen_dedup_stat_date
      ON podcast_stats_listen_dedup (stat_date);
  `);
};

export const down = (db: { exec: (sql: string) => void }) => {
  db.exec(`
    DROP INDEX IF EXISTS idx_podcast_stats_listen_dedup_stat_date;
    DROP TABLE IF EXISTS podcast_stats_listen_dedup;
    DROP TABLE IF EXISTS podcast_stats_episode_listens_daily;
    DROP TABLE IF EXISTS podcast_stats_episode_location_daily;
    DROP TABLE IF EXISTS podcast_stats_episode_daily;
    DROP TABLE IF EXISTS podcast_stats_rss_daily;
  `);
};
