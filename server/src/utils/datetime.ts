/**
 * Calendar helpers for HarborFM analytics / local dates.
 * Uses the configured app timezone (settings.timezone) when set; otherwise the
 * Node process / OS zone. Settings sync the override via setAppTimeZoneOverride.
 */

/** Configured IANA zone from settings; empty/null = use process default. */
let configuredTimeZoneOverride: string | null = null;

export function setAppTimeZoneOverride(timeZone: string | null | undefined): void {
  const trimmed = (timeZone ?? "").trim();
  configuredTimeZoneOverride = trimmed || null;
}

export function isValidIanaTimeZone(timeZone: string): boolean {
  try {
    Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function getProcessTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/** Resolved IANA zone used for analytics day/hour buckets. */
export function getAppTimeZone(): string {
  const configured = configuredTimeZoneOverride?.trim();
  if (configured && isValidIanaTimeZone(configured)) return configured;
  return getProcessTimeZone();
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function zonedDateHourParts(
  date: Date,
  timeZone: string,
): { year: number; month: number; day: number; hour: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
  };
}

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

/** Calendar date YYYY-MM-DD in the app timezone (settings or process local). */
export function formatLocalDateYYYYMMDD(d: Date = new Date()): string {
  const { year, month, day } = zonedDateHourParts(d, getAppTimeZone());
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** Hour 0–23 in the app timezone (settings or process local). */
export function getLocalHour(d: Date = new Date()): number {
  return zonedDateHourParts(d, getAppTimeZone()).hour;
}

/** Inclusive calendar window of `days` days ending today (app timezone). */
export function lastNLocalDateRange(days: number): {
  startDate: string;
  endDate: string;
} {
  const endDate = formatLocalDateYYYYMMDD();
  const tz = getAppTimeZone();
  // Walk back by subtracting UTC days from a noon UTC anchor for each step,
  // then format in app TZ so DST boundaries do not skip/double a calendar day.
  const endParts = zonedDateHourParts(new Date(), tz);
  const dates: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const utcGuess = Date.UTC(endParts.year, endParts.month - 1, endParts.day - i, 12, 0, 0);
    dates.push(formatLocalDateYYYYMMDD(new Date(utcGuess)));
  }
  return { startDate: dates[0]!, endDate };
}
