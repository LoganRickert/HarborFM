/**
 * API keys: disabled flag and valid_from (not valid before this datetime).
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`
    ALTER TABLE api_keys ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE api_keys ADD COLUMN valid_from TEXT;
  `);
};

export const down = (_db: { exec: (sql: string) => void }) => {};
