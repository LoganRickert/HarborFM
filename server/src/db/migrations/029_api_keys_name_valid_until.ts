/**
 * API keys: optional name and valid_until (ISO) for expiry.
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`
    ALTER TABLE api_keys ADD COLUMN name TEXT;
    ALTER TABLE api_keys ADD COLUMN valid_until TEXT;
  `);
};

export const down = (_db: { exec: (sql: string) => void }) => {};
