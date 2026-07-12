/**
 * Classify podcast app / client from User-Agent for stats.
 * Returns a display label or "Other". Order matters: first match wins.
 *
 * Examples (OPAWG / Podnews):
 * - Apple: Podcasts/1611.2.1 CFNetwork/1325.0.1 Darwin/21.1.0, Balados/4022.700.8 ...
 * - Spotify: Spotify/9.0.40 iOS/18.4.1 (iPhone15,3), Spotify/8.8.40.470 Android/33
 * - Google: GooglePodcasts/, GoogleChirp
 * - Pocket Casts: PocketCasts/1.0, Pocket%20Casts/7.96.0.4
 * - Overcast: Overcast/792 CFNetwork/..., Overcast/3.0 (+http://overcast.fm/; ...)
 */
const SOURCE_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "Apple Podcasts", pattern: /^Podcasts\/|^Balados\//i },
  { label: "Spotify", pattern: /Spotify\/[\d.]+/i },
  { label: "Amazon Music", pattern: /Amazon Music/i },
  { label: "Google Podcasts", pattern: /GooglePodcasts\/|GoogleChirp|^Podcasts$/i },
  { label: "Pocket Casts", pattern: /PocketCasts\/|Pocket%20Casts\/|^Pocket Casts\b|^Shifty Jelly Pocket Casts/i },
  { label: "Overcast", pattern: /^Overcast\/|^Overcast\s|Overcast Player\s/i },
  { label: "iHeartRadio", pattern: /iHeartRadio/i },
  { label: "Podbean", pattern: /Podbean\//i },
];

export function podcastSourceFromUserAgent(userAgent: string | null | undefined): string {
  const ua = (userAgent ?? "").trim();
  if (!ua) return "Other";
  for (const { label, pattern } of SOURCE_PATTERNS) {
    if (pattern.test(ua)) return label;
  }
  return "Other";
}
