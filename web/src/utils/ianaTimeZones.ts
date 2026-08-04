const FALLBACK_TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'America/Toronto',
  'America/Vancouver',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Asia/Kolkata',
  'Australia/Sydney',
  'Pacific/Auckland',
];

function listTimeZones(): string[] {
  try {
    const supported = (
      Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
    ).supportedValuesOf?.('timeZone');
    if (supported && supported.length > 0) return supported;
  } catch {
    /* fall through */
  }
  return FALLBACK_TIMEZONES;
}

const TIMEZONE_OPTIONS = listTimeZones();

/** IANA zones for selects, ensuring any current value remains selectable. */
export function ianaTimeZoneSelectOptions(current: string): string[] {
  const trimmed = current.trim();
  if (trimmed && !TIMEZONE_OPTIONS.includes(trimmed)) {
    return [trimmed, ...TIMEZONE_OPTIONS];
  }
  return TIMEZONE_OPTIONS;
}
