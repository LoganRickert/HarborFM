/**
 * Store bucket, region, and endpoint_url encrypted so they cannot be viewed after save.
 * New columns hold encrypted values; plaintext columns are set to '(encrypted)' when encrypted.
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`
    ALTER TABLE exports ADD COLUMN bucket_enc TEXT;
    ALTER TABLE exports ADD COLUMN region_enc TEXT;
    ALTER TABLE exports ADD COLUMN endpoint_url_enc TEXT;
  `);
};

export const down = (_db: { exec: (sql: string) => void }) => {};
