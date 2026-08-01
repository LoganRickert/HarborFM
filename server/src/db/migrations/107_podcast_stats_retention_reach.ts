/**
 * Website player retention reach (decile buckets 0,10,...,90).
 * Client-confirmed playback on HarborFM site/theme players.
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS podcast_stats_retention_reach (
      episode_id TEXT NOT NULL,
      stat_date TEXT NOT NULL,
      bucket INTEGER NOT NULL,
      client_key TEXT NOT NULL,
      PRIMARY KEY (episode_id, stat_date, bucket, client_key)
    );
    CREATE INDEX IF NOT EXISTS idx_podcast_stats_retention_reach_episode_date
      ON podcast_stats_retention_reach (episode_id, stat_date);
  `);
};

export const down = (db: { exec: (sql: string) => void }) => {
  db.exec(`DROP TABLE IF EXISTS podcast_stats_retention_reach;`);
};
