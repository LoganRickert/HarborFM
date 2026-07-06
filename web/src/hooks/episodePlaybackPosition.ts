const POSITION_KEY_PREFIX = 'hfm_layback_position';
export const EPISODE_POSITION_SAVE_INTERVAL_MS = 10_000;
const MIN_SAVE_SEC = 3;
const END_THRESHOLD_SEC = 10;

function storageKey(podcastSlug: string, episodeSlug: string): string {
  return `${POSITION_KEY_PREFIX}:${podcastSlug}:${episodeSlug}`;
}

export function readEpisodePlaybackPosition(
  podcastSlug: string,
  episodeSlug: string,
): number | null {
  try {
    const raw = localStorage.getItem(storageKey(podcastSlug, episodeSlug));
    if (raw == null) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

export function writeEpisodePlaybackPosition(
  podcastSlug: string,
  episodeSlug: string,
  timeSec: number,
  durationSec: number,
): void {
  if (timeSec < MIN_SAVE_SEC) return;
  if (durationSec > 0 && timeSec >= durationSec - END_THRESHOLD_SEC) {
    clearEpisodePlaybackPosition(podcastSlug, episodeSlug);
    return;
  }
  try {
    localStorage.setItem(storageKey(podcastSlug, episodeSlug), String(timeSec));
  } catch {
    // ignore quota / private mode
  }
}

export function clearEpisodePlaybackPosition(
  podcastSlug: string,
  episodeSlug: string,
): void {
  try {
    localStorage.removeItem(storageKey(podcastSlug, episodeSlug));
  } catch {
    // ignore
  }
}

export function clampStoredEpisodePosition(
  timeSec: number,
  durationSec: number,
): number | null {
  if (timeSec < MIN_SAVE_SEC) return null;
  if (durationSec > 0 && timeSec >= durationSec - END_THRESHOLD_SEC) return null;
  return timeSec;
}
