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

/** Calendar date YYYY-MM-DD in the server process local timezone (or TZ env). */
export function formatLocalDateYYYYMMDD(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Inclusive local-calendar window of `days` days ending today (server timezone). */
export function lastNLocalDateRange(days: number): { startDate: string; endDate: string } {
  const end = new Date();
  const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - (days - 1));
  return {
    startDate: formatLocalDateYYYYMMDD(start),
    endDate: formatLocalDateYYYYMMDD(end),
  };
}
