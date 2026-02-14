/**
 * Podcast cast members (hosts and guests) and episode cast assignments.
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS podcast_cast (
      id TEXT PRIMARY KEY,
      podcast_id TEXT NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('host', 'guest')),
      description TEXT,
      photo_path TEXT,
      photo_url TEXT,
      social_link_text TEXT,
      is_public INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS episode_cast (
      episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
      cast_id TEXT NOT NULL REFERENCES podcast_cast(id) ON DELETE CASCADE,
      PRIMARY KEY (episode_id, cast_id)
    );

    CREATE INDEX IF NOT EXISTS idx_podcast_cast_podcast ON podcast_cast(podcast_id);
    CREATE INDEX IF NOT EXISTS idx_episode_cast_episode ON episode_cast(episode_id);
    CREATE INDEX IF NOT EXISTS idx_episode_cast_cast ON episode_cast(cast_id);
  `);
};

export const down = (db: { exec: (sql: string) => void }) => {
  db.exec(`
    DROP INDEX IF EXISTS idx_episode_cast_cast;
    DROP INDEX IF EXISTS idx_episode_cast_episode;
    DROP INDEX IF EXISTS idx_podcast_cast_podcast;
    DROP TABLE IF EXISTS episode_cast;
    DROP TABLE IF EXISTS podcast_cast;
  `);
};
