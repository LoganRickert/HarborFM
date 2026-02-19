/**
 * Parse a SQLite datetime string as UTC.
 * SQLite datetime('now') returns UTC in format "YYYY-MM-DD HH:MM:SS".
 * JavaScript's Date() parses that as local time by default, causing timezone bugs.
 * Use this when reading datetime columns that store UTC.
 * Returns NaN if unparseable.
 */
export function parseUtcDatetime(str: string | null | undefined): number {
  if (!str || typeof str !== "string" || !str.trim()) return NaN;
  const iso = str.trim().replace(" ", "T") + "Z";
  return new Date(iso).getTime();
}

/** Parse datetime string to epoch ms. Returns NaN if unparseable. */
export function parseDatetimeToMs(str: string | null | undefined): number {
  if (!str || typeof str !== "string" || !str.trim()) return NaN;
  return new Date(str.trim()).getTime();
}
