/**
 * Hourly Downloads buckets (server-local date + hour) for time-of-day analytics.
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS podcast_stats_episode_listens_hourly (
      episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
      stat_date TEXT NOT NULL,
      stat_hour INTEGER NOT NULL,
      source TEXT NOT NULL DEFAULT 'Other',
      bot_count INTEGER NOT NULL DEFAULT 0,
      human_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (episode_id, stat_date, stat_hour, source)
    );
  `);
};

export const down = (db: { exec: (sql: string) => void }) => {
  db.exec(`DROP TABLE IF EXISTS podcast_stats_episode_listens_hourly;`);
};
