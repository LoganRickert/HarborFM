export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return '';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

/** Embed player: ceil seconds, leading zeros for hours/minutes/seconds (e.g. 01:05:09). */
export function formatDurationEmbed(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return '00:00';
  const total = Math.ceil(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/**
 * Parse a server datetime string as UTC (server stores UTC).
 * If the string has no timezone, appends 'Z' and normalizes space to 'T' so it displays correctly in local time.
 */
export function parseUtc(dateStr: string | null | undefined): Date | null {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const s = dateStr.trim();
  if (!s) return null;
  const hasTz = /Z$|[+-]\d{2}:?\d{2}$/.test(s);
  const normalized = hasTz ? s : s.replace(/Z?$/, '').replace(' ', 'T') + 'Z';
  const date = new Date(normalized);
  return Number.isFinite(date.getTime()) ? date : null;
}

/** Format as date only (long style), in local time. */
export function formatDate(dateStr: string | null | undefined): string {
  const d = parseUtc(dateStr);
  if (!d) return '';
  try {
    return d.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return '';
  }
}

/** Format as date + short time, in local time. */
export function formatDateTime(dateStr: string | null | undefined): string {
  const d = parseUtc(dateStr);
  if (!d) return '';
  try {
    return d.toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return '';
  }
}

/** Format as short date (e.g. "Feb 12, 2025") for lists. */
export function formatDateShort(dateStr: string | null | undefined): string {
  const d = parseUtc(dateStr);
  if (!d) return '';
  try {
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return '';
  }
}

export function formatSeasonEpisode(
  seasonNumber: number | null | undefined,
  episodeNumber: number | null | undefined
): string {
  if (seasonNumber != null && episodeNumber != null) {
    return `S${seasonNumber} E${episodeNumber}`;
  }
  if (seasonNumber != null) {
    return `S${seasonNumber}`;
  }
  if (episodeNumber != null) {
    return `E${episodeNumber}`;
  }
  return '';
}

/** Long form for embed: "Season 1 Episode 2", "Episode 2", or "Season 1". */
export function formatSeasonEpisodeLong(
  seasonNumber: number | null | undefined,
  episodeNumber: number | null | undefined
): string {
  if (seasonNumber != null && episodeNumber != null) {
    return `Season ${seasonNumber} Episode ${episodeNumber}`;
  }
  if (seasonNumber != null) {
    return `Season ${seasonNumber}`;
  }
  if (episodeNumber != null) {
    return `Episode ${episodeNumber}`;
  }
  return '';
}
