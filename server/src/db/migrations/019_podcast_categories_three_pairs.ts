/**
 * Replace category_tertiary with two more category pairs: primary_two/secondary_two and primary_three/secondary_three.
 * Supports up to 3 primaries and 3 secondaries (each secondary only valid when its primary is set).
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`ALTER TABLE podcasts ADD COLUMN category_primary_two TEXT;`);
  db.exec(`ALTER TABLE podcasts ADD COLUMN category_secondary_two TEXT;`);
  db.exec(`ALTER TABLE podcasts ADD COLUMN category_primary_three TEXT;`);
  db.exec(`ALTER TABLE podcasts ADD COLUMN category_secondary_three TEXT;`);
  db.exec(`ALTER TABLE podcasts DROP COLUMN category_tertiary;`);
};

export const down = (_db: { exec: (sql: string) => void }) => {
  // SQLite does not support adding a column back after drop without recreating the table; leave empty or document.
};
