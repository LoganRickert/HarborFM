/**
 * Rewrite absolute filesystem paths to relative (under DATA_DIR).
 * Enables DATA_DIR changes (e.g. PM2 to Docker) without breaking existing rows.
 * Only updates paths that look absolute; skips already-relative and null/empty.
 */
import type { Database } from "better-sqlite3";

const KNOWN_ROOTS = ["uploads", "processed", "library", "artwork", "rss", "sitemap"];

function isAbsolutePath(path: string): boolean {
  if (!path || !path.trim()) return false;
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);
}

function toRelative(absolute: string): string | null {
  const norm = absolute.replace(/\\/g, "/");
  for (const root of KNOWN_ROOTS) {
    const idx = norm.indexOf("/" + root + "/");
    if (idx >= 0) return norm.slice(idx + 1);
    // Also match path that ends with /root (unlikely but handle it)
    if (norm.endsWith("/" + root)) return norm.slice(norm.lastIndexOf("/") + 1);
  }
  return null;
}

function migrateColumn(
  db: Database,
  table: string,
  column: string,
): void {
  const rows = db.prepare(`SELECT id, ${column} FROM ${table}`).all() as {
    id: string;
    [k: string]: string | null;
  }[];
  const update = db.prepare(`UPDATE ${table} SET ${column} = ? WHERE id = ?`);
  for (const row of rows) {
    const val = row[column];
    if (val == null || val === "" || !isAbsolutePath(val)) continue;
    const rel = toRelative(val);
    if (rel) update.run(rel, row.id);
  }
}

/** Episodes have composite key (id); artwork/episodes need podcast_id for artwork base. */
function migrateEpisodes(db: Database): void {
  const rows = db
    .prepare(
      "SELECT id, artwork_path, audio_source_path, audio_final_path FROM episodes",
    )
    .all() as {
      id: string;
      artwork_path: string | null;
      audio_source_path: string | null;
      audio_final_path: string | null;
    }[];
  const upArt = db.prepare("UPDATE episodes SET artwork_path = ? WHERE id = ?");
  const upSrc = db.prepare(
    "UPDATE episodes SET audio_source_path = ? WHERE id = ?",
  );
  const upFin = db.prepare(
    "UPDATE episodes SET audio_final_path = ? WHERE id = ?",
  );
  for (const row of rows) {
    if (row.artwork_path && isAbsolutePath(row.artwork_path)) {
      const rel = toRelative(row.artwork_path);
      if (rel) upArt.run(rel, row.id);
    }
    if (row.audio_source_path && isAbsolutePath(row.audio_source_path)) {
      const rel = toRelative(row.audio_source_path);
      if (rel) upSrc.run(rel, row.id);
    }
    if (row.audio_final_path && isAbsolutePath(row.audio_final_path)) {
      const rel = toRelative(row.audio_final_path);
      if (rel) upFin.run(rel, row.id);
    }
  }
}

/** episode_segments: id + episode_id; we use id for UPDATE. */
function migrateEpisodeSegments(db: Database): void {
  const rows = db
    .prepare(
      "SELECT id, episode_id, audio_path FROM episode_segments WHERE audio_path IS NOT NULL",
    )
    .all() as { id: string; episode_id: string; audio_path: string }[];
  const update = db.prepare(
    "UPDATE episode_segments SET audio_path = ? WHERE id = ? AND episode_id = ?",
  );
  for (const row of rows) {
    if (!isAbsolutePath(row.audio_path)) continue;
    const rel = toRelative(row.audio_path);
    if (rel) update.run(rel, row.id, row.episode_id);
  }
}

/** podcast_cast: composite key (id, podcast_id). */
function migratePodcastCast(db: Database): void {
  try {
    const tableInfo = db.prepare("PRAGMA table_info(podcast_cast)").all() as {
      name: string;
    }[];
    if (!tableInfo.some((c) => c.name === "photo_path")) return;
  } catch {
    return; // table may not exist on very old installs
  }
  const rows = db
    .prepare(
      "SELECT id, podcast_id, photo_path FROM podcast_cast WHERE photo_path IS NOT NULL",
    )
    .all() as { id: string; podcast_id: string; photo_path: string }[];
  const update = db.prepare(
    "UPDATE podcast_cast SET photo_path = ? WHERE id = ? AND podcast_id = ?",
  );
  for (const row of rows) {
    if (!isAbsolutePath(row.photo_path)) continue;
    const rel = toRelative(row.photo_path);
    if (rel) update.run(rel, row.id, row.podcast_id);
  }
}

export const up = (db: Database) => {
  migrateColumn(db, "podcasts", "artwork_path");
  migrateEpisodes(db);
  migrateEpisodeSegments(db);
  migrateColumn(db, "reusable_assets", "audio_path");
  migratePodcastCast(db);
};

export const down = (_db: Database) => {
  // Irreversible without backup of old paths.
};
