/**
 * Podcast-aware traffic classification for analytics.
 *
 * Maps to existing bot_count / human_count columns:
 * - crawler to bot (directory agents, scrapers, empty UA)
 * - listener to human (podcast apps + normal browsers)
 *
 * Known podcast apps override isbot (which often marks Overcast, AntennaPod, etc. as bots).
 * Explicit crawler patterns override listener-looking UAs (e.g. Spotify/1.0 directory agent).
 */

import { isbot } from "isbot";

export type PodcastTrafficClass = "listener" | "crawler";

/** Directory / feed / search crawlers: always classified as crawler. */
const CRAWLER_PATTERNS: RegExp[] = [
  /^Spotify\/1\.0$/i, // Spotify directory poller (not the mobile/desktop app)
  /Amazon Music Podcast/i,
  /StitcherBot/i,
  /Podbean\/FeedUpdate/i,
  /FeedBurner/i,
  /Awario/i,
  /Googlebot/i,
  /Googlebot-Video/i,
  /bingbot/i,
  /Censys/i,
  /zgrab/i,
  /Audioscrape/i,
  /FeedMaster/i,
  /Tentacles/i,
  /WordPress\.com/i,
  /UniversalFeedParser/i,
  /Podchaser/i,
  /yushi-podcast/i,
  /GuzzleHttp/i,
  /^iTMS$/i,
  /^itms$/i,
  /^-$/,
  /^curl\//i,
  /^Go-http-client/i,
  /meta-externalagent/i,
  /AhrefsBot/i,
  /Baiduspider/i,
  /Dataprovider/i,
  /ClaudeBot/i,
  /Podcasts\/FeedParser/i,
  /PocketCasts\/1\.0 \(Pocket Casts Feed Parser/i,
  /iHeartRadio/i, // directory / feed agent UAs
];

/**
 * Real podcast listener clients: always listener even if isbot says otherwise.
 * Order does not matter; checked after crawler denylist.
 */
const LISTENER_PATTERNS: RegExp[] = [
  /^Podcasts\//i,
  /^Balados\//i,
  /AppleCoreMedia\//i,
  /^Overcast\//i,
  /Overcast Player/i,
  /PocketCasts\//i,
  /Pocket%20Casts\//i,
  /^Pocket Casts\b/i,
  /^Shifty Jelly Pocket Casts/i,
  /Spotify\/\d+\.\d+/i, // Spotify app (e.g. 8.x / 9.x), not Spotify/1.0
  /AntennaPod\//i,
  /CastBox\//i,
  /\bCastro\b/i,
  /BeyondPod/i,
  /Podkicker/i,
  /Deezer Podcasts/i,
  /GooglePodcasts\//i,
  /GoogleChirp/i,
];

function matchesAny(ua: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(ua));
}

/**
 * Classify a User-Agent for podcast RSS / enclosure stats.
 */
export function podcastTrafficClass(
  userAgent: string | null | undefined,
): PodcastTrafficClass {
  const ua = (userAgent ?? "").trim();
  if (!ua) return "crawler";
  if (matchesAny(ua, CRAWLER_PATTERNS)) return "crawler";
  if (matchesAny(ua, LISTENER_PATTERNS)) return "listener";
  // Normal browsers: not bots
  if (!isbot(ua)) return "listener";
  return "crawler";
}

/**
 * True when this UA should increment human_count (listener).
 * Prefer this over isHumanUserAgent for podcast stats.
 */
export function isPodcastListenerUserAgent(
  userAgent: string | null | undefined,
): boolean {
  return podcastTrafficClass(userAgent) === "listener";
}
