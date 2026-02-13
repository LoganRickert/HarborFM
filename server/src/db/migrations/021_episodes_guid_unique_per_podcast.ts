/**
 * Change episodes.guid from globally UNIQUE to unique per podcast: UNIQUE(podcast_id, guid).
 * SQLite does not support altering column constraints, so we recreate the table.
 * Temporarily disable foreign keys so we can drop episodes (episode_segments references it).
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec("PRAGMA foreign_keys = OFF");
  try {
    db.exec(`
    CREATE TABLE episodes_new (
      id TEXT PRIMARY KEY,
      podcast_id TEXT NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      guid TEXT NOT NULL,
      season_number INTEGER,
      episode_number INTEGER,
      episode_type TEXT,
      explicit INTEGER,
      publish_at TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      artwork_path TEXT,
      artwork_url TEXT,
      audio_source_path TEXT,
      audio_final_path TEXT,
      audio_mime TEXT,
      audio_bytes INTEGER,
      audio_duration_sec INTEGER,
      slug TEXT,
      episode_link TEXT,
      guid_is_permalink INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      description_copyright_snapshot TEXT,
      subtitle TEXT,
      summary TEXT,
      content_encoded TEXT,
      UNIQUE(podcast_id, guid)
    )
  `);
    db.exec(`
    INSERT INTO episodes_new SELECT
      id, podcast_id, title, description, guid, season_number, episode_number,
      episode_type, explicit, publish_at, status, artwork_path, artwork_url,
      audio_source_path, audio_final_path, audio_mime, audio_bytes, audio_duration_sec,
      slug, episode_link, guid_is_permalink, created_at, updated_at,
      description_copyright_snapshot, subtitle, summary, content_encoded
    FROM episodes
  `);
    db.exec(`DROP TABLE episodes`);
    db.exec(`ALTER TABLE episodes_new RENAME TO episodes`);
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_episodes_podcast ON episodes(podcast_id)`,
    );
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_episodes_status ON episodes(status)`,
    );
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_episodes_publish_at ON episodes(publish_at)`,
    );
    db.exec(`CREATE INDEX IF NOT EXISTS idx_episodes_slug ON episodes(slug)`);
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_episodes_podcast_slug ON episodes(podcast_id, slug)`,
    );
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
};

export const down = (_db: { exec: (sql: string) => void }) => {
  // Reverting would require recreating with guid UNIQUE again; leave empty.
};
