/**
 * Podcast 2.0 channel metadata JSON columns for Show Details More tab.
 * Migrates legacy funding_url/label and update_frequency_* into JSON, then drops those columns.
 * Rewrites flat license strings into {"identifier":"…"} JSON in place.
 */
import type { Database } from "better-sqlite3";

export const up = (db: Database) => {
  db.exec(`ALTER TABLE podcasts ADD COLUMN funding_links TEXT;`);
  db.exec(`ALTER TABLE podcasts ADD COLUMN podcast_txts TEXT;`);
  db.exec(`ALTER TABLE podcasts ADD COLUMN social_interacts TEXT;`);
  db.exec(`ALTER TABLE podcasts ADD COLUMN locations TEXT;`);
  db.exec(`ALTER TABLE podcasts ADD COLUMN chat TEXT;`);
  db.exec(`ALTER TABLE podcasts ADD COLUMN value_blocks TEXT;`);
  db.exec(`ALTER TABLE podcasts ADD COLUMN blocks TEXT;`);
  db.exec(`ALTER TABLE podcasts ADD COLUMN publisher TEXT;`);
  db.exec(`ALTER TABLE podcasts ADD COLUMN update_frequency TEXT;`);

  const rows = db
    .prepare(
      `SELECT id, funding_url, funding_label, license, update_frequency_rrule, update_frequency_label
       FROM podcasts`,
    )
    .all() as Array<{
    id: string;
    funding_url: string | null;
    funding_label: string | null;
    license: string | null;
    update_frequency_rrule: string | null;
    update_frequency_label: string | null;
  }>;

  const updateStmt = db.prepare(
    `UPDATE podcasts SET funding_links = ?, license = ?, update_frequency = ? WHERE id = ?`,
  );

  for (const row of rows) {
    let fundingLinks: string | null = null;
    const fundingUrl = typeof row.funding_url === "string" ? row.funding_url.trim() : "";
    if (fundingUrl) {
      const label =
        typeof row.funding_label === "string" && row.funding_label.trim()
          ? row.funding_label.trim()
          : null;
      fundingLinks = JSON.stringify([{ url: fundingUrl, text: label }]);
    }

    let license: string | null = row.license;
    if (typeof license === "string" && license.trim()) {
      const trimmed = license.trim();
      if (!trimmed.startsWith("{")) {
        license = JSON.stringify({ identifier: trimmed.slice(0, 128) });
      }
    } else {
      license = null;
    }

    let updateFrequency: string | null = null;
    const rrule =
      typeof row.update_frequency_rrule === "string" ? row.update_frequency_rrule.trim() : "";
    const label =
      typeof row.update_frequency_label === "string" ? row.update_frequency_label.trim() : "";
    if (rrule || label) {
      updateFrequency = JSON.stringify({
        rrule: rrule || null,
        label: label ? label.slice(0, 128) : null,
        complete: null,
        dtstart: null,
      });
    }

    updateStmt.run(fundingLinks, license, updateFrequency, row.id);
  }

  db.exec(`ALTER TABLE podcasts DROP COLUMN funding_url;`);
  db.exec(`ALTER TABLE podcasts DROP COLUMN funding_label;`);
  db.exec(`ALTER TABLE podcasts DROP COLUMN update_frequency_rrule;`);
  db.exec(`ALTER TABLE podcasts DROP COLUMN update_frequency_label;`);
};

export const down = (_db: Database) => {
  // Irreversible: legacy columns dropped after data copy.
};
