/**
 * Private IANA time zone for cast members (meeting email local times).
 * Also stored on profile-pending so cast can propose a change.
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`
    ALTER TABLE podcast_cast ADD COLUMN time_zone TEXT;
    ALTER TABLE podcast_cast_profile_pending ADD COLUMN time_zone TEXT;
  `);
};

export const down = (db: { exec: (sql: string) => void }) => {
  // SQLite cannot drop columns portably before 3.35; leave columns in place.
  void db;
};
