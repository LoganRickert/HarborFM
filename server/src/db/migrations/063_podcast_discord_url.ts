/** Add Discord link for podcast Follow section. */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`
    ALTER TABLE podcasts ADD COLUMN discord_url TEXT;
  `);
};

export const down = (_db: { exec: (sql: string) => void }) => {};
