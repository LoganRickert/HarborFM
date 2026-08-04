/**
 * Remap server-local (stat_date, stat_hour) into browser-local hour or UTC date+hour.
 * Storage uses the server IANA timezone; charts use the viewer timezone; exports use UTC.
 */

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function formatUtcDateYYYYMMDD(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function isValidTimeZone(timeZone: string): boolean {
  try {
    Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

/** Parts of `date` as seen in `timeZone`. */
function zonedParts(
  date: Date,
  timeZone: string,
): { year: number; month: number; day: number; hour: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '0';
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
  };
}

/**
 * UTC instant for wall time `statDate` + `statHour:00` in `serverTimeZone`.
 * Uses iterative offset correction (handles DST).
 */
export function serverLocalWallTimeToUtcMs(
  statDate: string,
  statHour: number,
  serverTimeZone: string,
): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(statDate)) return null;
  if (!Number.isInteger(statHour) || statHour < 0 || statHour > 23) return null;
  if (!serverTimeZone || !isValidTimeZone(serverTimeZone)) return null;

  const [yStr, mStr, dStr] = statDate.split('-');
  const year = Number(yStr);
  const month = Number(mStr);
  const day = Number(dStr);
  // First guess: treat the wall time as if it were UTC.
  let utcMs = Date.UTC(year, month - 1, day, statHour, 0, 0, 0);
  for (let i = 0; i < 3; i++) {
    const parts = zonedParts(new Date(utcMs), serverTimeZone);
    const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, 0, 0, 0);
    const desired = Date.UTC(year, month - 1, day, statHour, 0, 0, 0);
    utcMs += desired - asUtc;
  }
  const check = zonedParts(new Date(utcMs), serverTimeZone);
  if (
    check.year !== year ||
    check.month !== month ||
    check.day !== day ||
    check.hour !== statHour
  ) {
    // Ambiguous/skipped DST hour: return best effort anyway.
  }
  return utcMs;
}

/** Hour 0–23 in the browser's local timezone for a stored server-local bucket. */
export function serverLocalToBrowserHour(
  statDate: string,
  statHour: number,
  serverTimeZone: string | null | undefined,
): number {
  const tz = serverTimeZone?.trim() || '';
  if (!tz || !isValidTimeZone(tz)) return statHour;
  const utcMs = serverLocalWallTimeToUtcMs(statDate, statHour, tz);
  if (utcMs == null) return statHour;
  return new Date(utcMs).getHours();
}

/** UTC calendar date + hour for a stored server-local bucket. */
export function serverLocalToUtcDateHour(
  statDate: string,
  statHour: number,
  serverTimeZone: string | null | undefined,
): { date: string; hour: number } {
  const tz = serverTimeZone?.trim() || '';
  if (!tz || !isValidTimeZone(tz)) {
    return { date: statDate, hour: statHour };
  }
  const utcMs = serverLocalWallTimeToUtcMs(statDate, statHour, tz);
  if (utcMs == null) return { date: statDate, hour: statHour };
  const d = new Date(utcMs);
  return { date: formatUtcDateYYYYMMDD(d), hour: d.getUTCHours() };
}

/** Label like "12 AM", "1 PM" for hour 0–23. */
export function formatHourLabel(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  if (h === 0) return '12 AM';
  if (h === 12) return '12 PM';
  if (h < 12) return `${h} AM`;
  return `${h - 12} PM`;
}
