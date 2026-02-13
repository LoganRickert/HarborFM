/**
 * Snapshot of library segment name + copyright lines, stored when building final episode.
 * Appended to episode description in RSS/public output.
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(
    `ALTER TABLE episodes ADD COLUMN description_copyright_snapshot TEXT;`,
  );
};

export const down = (_db: { exec: (sql: string) => void }) => {
  // SQLite does not support DROP COLUMN; migration is additive only.
};
