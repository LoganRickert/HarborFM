/**
 * Podcast 2.0 episode metadata JSON columns for More-tab editors:
 * txt, socialInteract, location, license, image, funding, chat, value.
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`ALTER TABLE episodes ADD COLUMN podcast_txts TEXT;`);
  db.exec(`ALTER TABLE episodes ADD COLUMN social_interacts TEXT;`);
  db.exec(`ALTER TABLE episodes ADD COLUMN locations TEXT;`);
  db.exec(`ALTER TABLE episodes ADD COLUMN license TEXT;`);
  db.exec(`ALTER TABLE episodes ADD COLUMN podcast_images TEXT;`);
  db.exec(`ALTER TABLE episodes ADD COLUMN funding_links TEXT;`);
  db.exec(`ALTER TABLE episodes ADD COLUMN chat TEXT;`);
  db.exec(`ALTER TABLE episodes ADD COLUMN value_blocks TEXT;`);
};

export const down = (_db: { exec: (sql: string) => void }) => {
  // SQLite does not support DROP COLUMN easily; leave columns in place on rollback.
};
