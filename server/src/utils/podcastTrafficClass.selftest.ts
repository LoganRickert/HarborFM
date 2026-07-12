/**
 * Lightweight checks for podcastTrafficClass (run with: npx tsx src/utils/podcastTrafficClass.selftest.ts).
 * No test runner required in this package.
 */
import assert from "node:assert/strict";
import {
  isPodcastListenerUserAgent,
  podcastTrafficClass,
} from "./podcastTrafficClass.js";

const cases: Array<{ ua: string; expect: "listener" | "crawler" }> = [
  { ua: "", expect: "crawler" },
  { ua: "Spotify/1.0", expect: "crawler" },
  { ua: "Amazon Music Podcast", expect: "crawler" },
  { ua: "StitcherBot (MP3 Search Bot)", expect: "crawler" },
  { ua: "Podbean/FeedUpdate 2.1", expect: "crawler" },
  { ua: "iTMS", expect: "crawler" },
  {
    ua: "Mozilla/5.0 (Linux;) AppleWebKit/ Chrome/ Safari - iHeartRadio",
    expect: "crawler",
  },
  {
    ua: "Podcasts/1611.2.1 CFNetwork/1325.0.1 Darwin/21.1.0",
    expect: "listener",
  },
  {
    ua: "Overcast/3.0 (+http://overcast.fm/; iOS podcast app)",
    expect: "listener",
  },
  {
    ua: "Spotify/9.0.40 iOS/18.4.1 (iPhone15,3)",
    expect: "listener",
  },
  {
    ua: "AntennaPod/3.0.0",
    expect: "listener",
  },
  {
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    expect: "listener",
  },
];

for (const { ua, expect } of cases) {
  const got = podcastTrafficClass(ua);
  assert.equal(got, expect, `UA ${JSON.stringify(ua)} to ${got}, expected ${expect}`);
  assert.equal(isPodcastListenerUserAgent(ua), expect === "listener");
}

console.log(`podcastTrafficClass.selftest: ${cases.length} cases ok`);
