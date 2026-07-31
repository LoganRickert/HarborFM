/**
 * Episodes: youtube_url - optional link to the YouTube version of this episode.
 * Used for public page embeds and Podcasting 2.0 contentLink.
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`ALTER TABLE episodes ADD COLUMN youtube_url TEXT;`);
};

export const down = (_db: { exec: (sql: string) => void }) => {
  // SQLite does not support DROP COLUMN; migration is additive only.
};
