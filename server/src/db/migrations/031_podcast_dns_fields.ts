/**
 * Podcast DNS fields: link domain, managed domain, managed sub-domain, encrypted Cloudflare API key.
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`
    ALTER TABLE podcasts ADD COLUMN link_domain TEXT;
    ALTER TABLE podcasts ADD COLUMN managed_domain TEXT;
    ALTER TABLE podcasts ADD COLUMN managed_sub_domain TEXT;
    ALTER TABLE podcasts ADD COLUMN cloudflare_api_key_enc TEXT;
  `);
};

export const down = (_db: { exec: (sql: string) => void }) => {};
