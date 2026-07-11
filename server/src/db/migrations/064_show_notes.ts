/** Episode planning show notes checklist + guest visibility flag. */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`
    ALTER TABLE episodes ADD COLUMN show_notes_guest_visible INTEGER NOT NULL DEFAULT 0;

    CREATE TABLE episode_show_notes_items (
      id TEXT PRIMARY KEY,
      episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      text TEXT NOT NULL DEFAULT '',
      duration_min INTEGER,
      checked INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_episode_show_notes_items_episode ON episode_show_notes_items(episode_id);
  `);
};

export const down = (_db: { exec: (sql: string) => void }) => {};
