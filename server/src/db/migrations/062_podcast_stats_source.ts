/**
 * Add source column (Apple Podcasts, Spotify, Other, etc.) to podcast stats tables.
 * SQLite cannot add a column to an existing primary key, so we recreate each table
 * with source in the PK and migrate existing rows as source = 'Other'.
 */
export const up = (db: { exec: (sql: string) => void }) => {
  // podcast_stats_rss_daily
  db.exec(`
    CREATE TABLE podcast_stats_rss_daily_new (
      podcast_id TEXT NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
      stat_date TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'Other',
      bot_count INTEGER NOT NULL DEFAULT 0,
      human_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (podcast_id, stat_date, source)
    );
    INSERT INTO podcast_stats_rss_daily_new (podcast_id, stat_date, source, bot_count, human_count)
    SELECT podcast_id, stat_date, 'Other', bot_count, human_count FROM podcast_stats_rss_daily;
    DROP TABLE podcast_stats_rss_daily;
    ALTER TABLE podcast_stats_rss_daily_new RENAME TO podcast_stats_rss_daily;
  `);

  // podcast_stats_episode_daily
  db.exec(`
    CREATE TABLE podcast_stats_episode_daily_new (
      episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
      stat_date TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'Other',
      bot_count INTEGER NOT NULL DEFAULT 0,
      human_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (episode_id, stat_date, source)
    );
    INSERT INTO podcast_stats_episode_daily_new (episode_id, stat_date, source, bot_count, human_count)
    SELECT episode_id, stat_date, 'Other', bot_count, human_count FROM podcast_stats_episode_daily;
    DROP TABLE podcast_stats_episode_daily;
    ALTER TABLE podcast_stats_episode_daily_new RENAME TO podcast_stats_episode_daily;
  `);

  // podcast_stats_episode_location_daily
  db.exec(`
    CREATE TABLE podcast_stats_episode_location_daily_new (
      episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
      stat_date TEXT NOT NULL,
      location TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'Other',
      bot_count INTEGER NOT NULL DEFAULT 0,
      human_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (episode_id, stat_date, location, source)
    );
    INSERT INTO podcast_stats_episode_location_daily_new (episode_id, stat_date, location, source, bot_count, human_count)
    SELECT episode_id, stat_date, location, 'Other', bot_count, human_count FROM podcast_stats_episode_location_daily;
    DROP TABLE podcast_stats_episode_location_daily;
    ALTER TABLE podcast_stats_episode_location_daily_new RENAME TO podcast_stats_episode_location_daily;
  `);

  // podcast_stats_episode_listens_daily
  db.exec(`
    CREATE TABLE podcast_stats_episode_listens_daily_new (
      episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
      stat_date TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'Other',
      bot_count INTEGER NOT NULL DEFAULT 0,
      human_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (episode_id, stat_date, source)
    );
    INSERT INTO podcast_stats_episode_listens_daily_new (episode_id, stat_date, source, bot_count, human_count)
    SELECT episode_id, stat_date, 'Other', bot_count, human_count FROM podcast_stats_episode_listens_daily;
    DROP TABLE podcast_stats_episode_listens_daily;
    ALTER TABLE podcast_stats_episode_listens_daily_new RENAME TO podcast_stats_episode_listens_daily;
  `);
};

export const down = (db: { exec: (sql: string) => void }) => {
  // Recreate original tables without source and collapse rows (sum counts per entity/date)
  db.exec(`
    CREATE TABLE podcast_stats_rss_daily_old (
      podcast_id TEXT NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
      stat_date TEXT NOT NULL,
      bot_count INTEGER NOT NULL DEFAULT 0,
      human_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (podcast_id, stat_date)
    );
    INSERT INTO podcast_stats_rss_daily_old (podcast_id, stat_date, bot_count, human_count)
    SELECT podcast_id, stat_date, SUM(bot_count), SUM(human_count) FROM podcast_stats_rss_daily GROUP BY podcast_id, stat_date;
    DROP TABLE podcast_stats_rss_daily;
    ALTER TABLE podcast_stats_rss_daily_old RENAME TO podcast_stats_rss_daily;
  `);

  db.exec(`
    CREATE TABLE podcast_stats_episode_daily_old (
      episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
      stat_date TEXT NOT NULL,
      bot_count INTEGER NOT NULL DEFAULT 0,
      human_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (episode_id, stat_date)
    );
    INSERT INTO podcast_stats_episode_daily_old (episode_id, stat_date, bot_count, human_count)
    SELECT episode_id, stat_date, SUM(bot_count), SUM(human_count) FROM podcast_stats_episode_daily GROUP BY episode_id, stat_date;
    DROP TABLE podcast_stats_episode_daily;
    ALTER TABLE podcast_stats_episode_daily_old RENAME TO podcast_stats_episode_daily;
  `);

  db.exec(`
    CREATE TABLE podcast_stats_episode_location_daily_old (
      episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
      stat_date TEXT NOT NULL,
      location TEXT NOT NULL,
      bot_count INTEGER NOT NULL DEFAULT 0,
      human_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (episode_id, stat_date, location)
    );
    INSERT INTO podcast_stats_episode_location_daily_old (episode_id, stat_date, location, bot_count, human_count)
    SELECT episode_id, stat_date, location, SUM(bot_count), SUM(human_count) FROM podcast_stats_episode_location_daily GROUP BY episode_id, stat_date, location;
    DROP TABLE podcast_stats_episode_location_daily;
    ALTER TABLE podcast_stats_episode_location_daily_old RENAME TO podcast_stats_episode_location_daily;
  `);

  db.exec(`
    CREATE TABLE podcast_stats_episode_listens_daily_old (
      episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
      stat_date TEXT NOT NULL,
      bot_count INTEGER NOT NULL DEFAULT 0,
      human_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (episode_id, stat_date)
    );
    INSERT INTO podcast_stats_episode_listens_daily_old (episode_id, stat_date, bot_count, human_count)
    SELECT episode_id, stat_date, SUM(bot_count), SUM(human_count) FROM podcast_stats_episode_listens_daily GROUP BY episode_id, stat_date;
    DROP TABLE podcast_stats_episode_listens_daily;
    ALTER TABLE podcast_stats_episode_listens_daily_old RENAME TO podcast_stats_episode_listens_daily;
  `);
};
