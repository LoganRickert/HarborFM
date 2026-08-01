/**
 * Classify podcast app / client for stats.
 * Returns a display label or "Other". Order matters: first match wins.
 *
 * Prefer podcastSourceFromRequest when Referer / hf_src are available
 * so website players are labeled "Website" instead of "Other".
 */

const SOURCE_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  // Apple directory agents (still crawlers in traffic class)
  { label: "Apple Podcasts", pattern: /^iTMS$/i },
  { label: "Apple Podcasts", pattern: /^itms$/i },
  { label: "Apple Podcasts", pattern: /^Podcasts\/|^Balados\//i },
  { label: "Spotify", pattern: /Spotify\/[\d.]+/i },
  { label: "Amazon Music", pattern: /Amazon Music/i },
  { label: "Google Podcasts", pattern: /GooglePodcasts\/|GoogleChirp|^Podcasts$/i },
  {
    label: "Pocket Casts",
    pattern:
      /PocketCasts\/|Pocket%20Casts\/|^Pocket Casts\b|^Shifty Jelly Pocket Casts/i,
  },
  { label: "Overcast", pattern: /^Overcast\/|^Overcast\s|Overcast Player\s/i },
  { label: "iHeartRadio", pattern: /iHeartRadio/i },
  { label: "Podbean", pattern: /Podbean\//i },
];

/** Browser-like UAs used by the public site player (and generic browsers). */
const BROWSER_UA_RE =
  /Mozilla\/5\.0.*(Chrome|Chromium|Firefox|Edg|Safari|OPR)\//i;

export type PodcastSourceRequest = {
  userAgent?: string | null;
  referer?: string | null;
  /** Query value for hf_src (e.g. "web" from site player). */
  hfSrc?: string | null;
};

function normalizeHfSrc(raw: string | null | undefined): string {
  return (raw ?? "").trim().toLowerCase();
}

/**
 * Source label from User-Agent only (legacy). Prefer podcastSourceFromRequest.
 */
export function podcastSourceFromUserAgent(
  userAgent: string | null | undefined,
): string {
  return podcastSourceFromRequest({ userAgent });
}

/**
 * Classify download/RSS source using UA plus optional site signals.
 * Website wins when hf_src=web, or when a browser UA has an HTTP Referer,
 * or when the UA is clearly a browser without a known app match.
 */
export function podcastSourceFromRequest(opts: PodcastSourceRequest): string {
  if (normalizeHfSrc(opts.hfSrc) === "web") return "Website";

  const ua = (opts.userAgent ?? "").trim();
  if (!ua) return "Other";

  for (const { label, pattern } of SOURCE_PATTERNS) {
    if (pattern.test(ua)) return label;
  }

  // Browsers (site player or direct play) map to Website. Known apps matched above.
  if (BROWSER_UA_RE.test(ua)) return "Website";

  return "Other";
}

/** Bucket labels for the Apps chart on the analytics page. */
export function bucketAnalyticsAppSource(source: string): string {
  const s = (source ?? "").trim();
  if (s === "Spotify") return "Spotify";
  if (s === "Apple Podcasts") return "Apple Podcasts";
  if (s === "Website") return "Website";
  return "Other";
}
