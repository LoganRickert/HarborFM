/**
 * New show and episode fields from RSS: subtitle, summary, funding, persons,
 * updateFrequency, spotify, apple_podcasts_verify (podcasts); subtitle, summary,
 * content_encoded (episodes).
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`ALTER TABLE podcasts ADD COLUMN subtitle TEXT;`);
  db.exec(`ALTER TABLE podcasts ADD COLUMN summary TEXT;`);
  db.exec(`ALTER TABLE podcasts ADD COLUMN funding_url TEXT;`);
  db.exec(`ALTER TABLE podcasts ADD COLUMN funding_label TEXT;`);
  db.exec(`ALTER TABLE podcasts ADD COLUMN persons TEXT;`);
  db.exec(`ALTER TABLE podcasts ADD COLUMN update_frequency_rrule TEXT;`);
  db.exec(`ALTER TABLE podcasts ADD COLUMN update_frequency_label TEXT;`);
  db.exec(`ALTER TABLE podcasts ADD COLUMN spotify_recent_count INTEGER;`);
  db.exec(`ALTER TABLE podcasts ADD COLUMN spotify_country_of_origin TEXT;`);
  db.exec(`ALTER TABLE podcasts ADD COLUMN apple_podcasts_verify TEXT;`);

  db.exec(`ALTER TABLE episodes ADD COLUMN subtitle TEXT;`);
  db.exec(`ALTER TABLE episodes ADD COLUMN summary TEXT;`);
  db.exec(`ALTER TABLE episodes ADD COLUMN content_encoded TEXT;`);
};

export const down = (_db: { exec: (sql: string) => void }) => {
  // SQLite does not support DROP COLUMN without table recreation; leave empty.
};
