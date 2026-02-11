/**
 * Associate contact messages with a podcast and/or episode (e.g. feedback from feed pages).
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`
    ALTER TABLE contact_messages ADD COLUMN podcast_id TEXT REFERENCES podcasts(id);
    ALTER TABLE contact_messages ADD COLUMN episode_id TEXT REFERENCES episodes(id);
    CREATE INDEX IF NOT EXISTS idx_contact_messages_podcast_id ON contact_messages(podcast_id);
    CREATE INDEX IF NOT EXISTS idx_contact_messages_episode_id ON contact_messages(episode_id);
  `);
};

export const down = (_db: { exec: (sql: string) => void }) => {};
