/**
 * Podcast: show_scheduled_episodes (when on, future-dated scheduled/published episodes appear on public feed with placeholder).
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`ALTER TABLE podcasts ADD COLUMN show_scheduled_episodes INTEGER DEFAULT 0;`);
};

export const down = (_db: { exec: (sql: string) => void }) => {
  // SQLite does not support DROP COLUMN; migration is additive only.
};
