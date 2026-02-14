/**
 * Podcast social and platform links: Apple Podcasts, Spotify, Amazon Music,
 * Podcast Index, Listen Notes, Castbox, X, Facebook, Instagram, TikTok, YouTube.
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`
    ALTER TABLE podcasts ADD COLUMN apple_podcasts_url TEXT;
    ALTER TABLE podcasts ADD COLUMN spotify_url TEXT;
    ALTER TABLE podcasts ADD COLUMN amazon_music_url TEXT;
    ALTER TABLE podcasts ADD COLUMN podcast_index_url TEXT;
    ALTER TABLE podcasts ADD COLUMN listen_notes_url TEXT;
    ALTER TABLE podcasts ADD COLUMN castbox_url TEXT;
    ALTER TABLE podcasts ADD COLUMN x_url TEXT;
    ALTER TABLE podcasts ADD COLUMN facebook_url TEXT;
    ALTER TABLE podcasts ADD COLUMN instagram_url TEXT;
    ALTER TABLE podcasts ADD COLUMN tiktok_url TEXT;
    ALTER TABLE podcasts ADD COLUMN youtube_url TEXT;
  `);
};

export const down = (_db: { exec: (sql: string) => void }) => {};
