/**
 * Initial schema: full consolidated schema as of latest migrations
 */
export const up = (db: { exec: (sql: string) => void }) => {

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      role TEXT DEFAULT 'user',
      disabled INTEGER DEFAULT 0,
      disk_bytes_used INTEGER DEFAULT 0,
      last_login_at TEXT,
      last_login_ip TEXT,
      last_login_user_agent TEXT,
      last_login_location TEXT
    );

    CREATE TABLE IF NOT EXISTS podcasts (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      slug TEXT NOT NULL,
      description TEXT DEFAULT '',
      language TEXT DEFAULT 'en',
      author_name TEXT DEFAULT '',
      owner_name TEXT DEFAULT '',
      email TEXT DEFAULT '',
      category_primary TEXT DEFAULT '',
      category_secondary TEXT,
      category_tertiary TEXT,
      explicit INTEGER NOT NULL DEFAULT 0,
      artwork_path TEXT,
      artwork_url TEXT,
      site_url TEXT,
      copyright TEXT,
      podcast_guid TEXT,
      locked INTEGER DEFAULT 0,
      license TEXT,
      itunes_type TEXT DEFAULT 'episodic',
      medium TEXT DEFAULT 'podcast',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(owner_user_id, slug)
    );

    CREATE TABLE IF NOT EXISTS episodes (
      id TEXT PRIMARY KEY,
      podcast_id TEXT NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      guid TEXT UNIQUE NOT NULL,
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
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS exports (
      id TEXT PRIMARY KEY,
      podcast_id TEXT NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      endpoint_url TEXT,
      name TEXT NOT NULL,
      bucket TEXT NOT NULL,
      prefix TEXT DEFAULT '',
      region TEXT NOT NULL,
      access_key_id TEXT NOT NULL,
      secret_access_key TEXT NOT NULL,
      access_key_id_enc TEXT,
      secret_access_key_enc TEXT,
      public_base_url TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS export_runs (
      id TEXT PRIMARY KEY,
      export_id TEXT NOT NULL REFERENCES exports(id) ON DELETE CASCADE,
      podcast_id TEXT NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      log TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS reusable_assets (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      audio_path TEXT NOT NULL,
      duration_sec INTEGER NOT NULL,
      tag TEXT,
      global_asset INTEGER DEFAULT 0,
      copyright TEXT,
      license TEXT,
      source_url TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    
    CREATE TABLE IF NOT EXISTS episode_segments (
      id TEXT PRIMARY KEY,
      episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('recorded', 'reusable')),
      reusable_asset_id TEXT REFERENCES reusable_assets(id) ON DELETE SET NULL,
      audio_path TEXT,
      duration_sec INTEGER NOT NULL DEFAULT 0,
      name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS login_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ip TEXT NOT NULL,
      context TEXT NOT NULL,
      attempted_email TEXT,
      user_agent TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ip_bans (
      ip TEXT NOT NULL,
      context TEXT NOT NULL,
      banned_until TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (ip, context)
    );

    CREATE INDEX IF NOT EXISTS idx_podcasts_owner ON podcasts(owner_user_id);
    CREATE INDEX IF NOT EXISTS idx_podcasts_guid ON podcasts(podcast_guid);
    CREATE INDEX IF NOT EXISTS idx_episodes_podcast ON episodes(podcast_id);
    CREATE INDEX IF NOT EXISTS idx_episodes_status ON episodes(status);
    CREATE INDEX IF NOT EXISTS idx_episodes_publish_at ON episodes(publish_at);
    CREATE INDEX IF NOT EXISTS idx_episodes_slug ON episodes(slug);
    CREATE INDEX IF NOT EXISTS idx_episodes_podcast_slug ON episodes(podcast_id, slug);
    CREATE INDEX IF NOT EXISTS idx_exports_podcast ON exports(podcast_id);
    CREATE INDEX IF NOT EXISTS idx_export_runs_export ON export_runs(export_id);
    CREATE INDEX IF NOT EXISTS idx_reusable_assets_owner ON reusable_assets(owner_user_id);
    CREATE INDEX IF NOT EXISTS idx_episode_segments_episode ON episode_segments(episode_id);
    CREATE INDEX IF NOT EXISTS idx_login_attempts_ip_context_created_at
      ON login_attempts (ip, context, created_at);
    CREATE INDEX IF NOT EXISTS idx_login_attempts_ip_context_created_at_email
      ON login_attempts (ip, context, created_at, attempted_email);
    CREATE INDEX IF NOT EXISTS idx_ip_bans_until ON ip_bans (banned_until);
  `);
};

export const down = (db: { exec: (sql: string) => void }) => {
  db.exec(`
    DROP INDEX IF EXISTS idx_ip_bans_until;
    DROP INDEX IF EXISTS idx_login_attempts_ip_context_created_at_email;
    DROP INDEX IF EXISTS idx_login_attempts_ip_context_created_at;
    DROP INDEX IF EXISTS idx_episode_segments_episode;
    DROP INDEX IF EXISTS idx_reusable_assets_owner;
    DROP INDEX IF EXISTS idx_export_runs_export;
    DROP INDEX IF EXISTS idx_exports_podcast;
    DROP INDEX IF EXISTS idx_episodes_podcast_slug;
    DROP INDEX IF EXISTS idx_episodes_slug;
    DROP INDEX IF EXISTS idx_episodes_publish_at;
    DROP INDEX IF EXISTS idx_episodes_status;
    DROP INDEX IF EXISTS idx_episodes_podcast;
    DROP INDEX IF EXISTS idx_podcasts_guid;
    DROP INDEX IF EXISTS idx_podcasts_owner;
    DROP TABLE IF EXISTS ip_bans;
    DROP TABLE IF EXISTS login_attempts;
    DROP TABLE IF EXISTS settings;
    DROP TABLE IF EXISTS episode_segments;
    DROP TABLE IF EXISTS reusable_assets;
    DROP TABLE IF EXISTS export_runs;
    DROP TABLE IF EXISTS exports;
    DROP TABLE IF EXISTS episodes;
    DROP TABLE IF EXISTS podcasts;
    DROP TABLE IF EXISTS users;
  `);
};
