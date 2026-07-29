/**
 * Cast social_links: migrate social_link_text into a JSON array, then drop the old column.
 */
import type { Database } from "better-sqlite3";

export const up = (db: Database) => {
  db.exec(`
    ALTER TABLE podcast_cast ADD COLUMN social_links TEXT NOT NULL DEFAULT '[]';
  `);

  const rows = db
    .prepare(
      `SELECT id, social_link_text FROM podcast_cast
       WHERE social_link_text IS NOT NULL AND trim(social_link_text) != ''`,
    )
    .all() as { id: string; social_link_text: string }[];

  const update = db.prepare(
    `UPDATE podcast_cast SET social_links = ? WHERE id = ?`,
  );
  for (const row of rows) {
    const url = String(row.social_link_text).trim();
    if (!url) continue;
    update.run(JSON.stringify([url]), row.id);
  }

  db.exec(`ALTER TABLE podcast_cast DROP COLUMN social_link_text;`);
};

export const down = (_db: Database) => {
  // Column drop is not reversed; leave social_links in place.
};
