/**
 * Fetch and parse RSS/Atom feeds for podcast import.
 * Uses fast-xml-parser 5.3.5. Handles pagination via atom:link rel="next",
 * dedupes by guid → enclosure url → (title + pubDate), returns oldest-first.
 */

import { XMLParser } from "fast-xml-parser";
import { IMPORT_USER_AGENT, IMPORT_FETCH_TIMEOUT_MS } from "../config.js";
import { assertUrlNotPrivate } from "../utils/ssrf.js";
const MAX_RETRIES = 3;
const CONSECUTIVE_EMPTY_PAGES_STOP = 2;

export interface ImportChannelMeta {
  title: string;
  description: string;
  subtitle: string | null;
  summary: string | null;
  language: string;
  author_name: string;
  owner_name: string;
  email: string;
  category_primary: string;
  category_secondary: string | null;
  category_primary_two: string | null;
  category_secondary_two: string | null;
  category_primary_three: string | null;
  category_secondary_three: string | null;
  explicit: number;
  site_url: string | null;
  artwork_url: string | null;
  copyright: string | null;
  license: string | null;
  itunes_type: string;
  medium: string;
  podcast_guid: string | null;
  locked: number;
  funding_url: string | null;
  funding_label: string | null;
  persons: string | null;
  update_frequency_rrule: string | null;
  update_frequency_label: string | null;
  spotify_recent_count: number | null;
  spotify_country_of_origin: string | null;
  apple_podcasts_verify: string | null;
}

export interface ImportEpisodeItem {
  title: string;
  description: string;
  subtitle: string | null;
  summary: string | null;
  content_encoded: string | null;
  guid: string;
  guidIsPermalink: 0 | 1;
  enclosureUrl: string;
  enclosureType: string;
  pubDate: string | null;
  season_number: number | null;
  episode_number: number | null;
  episode_type: string | null;
  explicit: number | null;
  artwork_url: string | null;
  episode_link: string | null;
}

export interface ImportFeedResult {
  channel: ImportChannelMeta;
  episodes: ImportEpisodeItem[];
}

function normalizeUrl(base: string, relative: string): string {
  try {
    return new URL(relative, base).toString();
  } catch {
    return relative;
  }
}

function _resolveRedirect(
  url: string,
  controller: AbortController,
): Promise<string> {
  return fetch(url, {
    method: "GET",
    redirect: "follow",
    signal: controller.signal,
    headers: { "User-Agent": IMPORT_USER_AGENT },
  }).then((res) => res.url);
}

async function fetchWithRetry(
  url: string,
  controller: AbortController,
): Promise<{ body: string; finalUrl: string }> {
  let lastError: Error | null = null;
  let waitMs = 1000;
  let finalUrl = url;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const timeoutId = setTimeout(
      () => controller.abort(),
      IMPORT_FETCH_TIMEOUT_MS,
    );
    try {
      const res = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: { "User-Agent": IMPORT_USER_AGENT },
      });
      finalUrl = res.url;

      if (res.status === 429 || res.status === 503) {
        const retryAfter = res.headers.get("Retry-After");
        const wait = retryAfter ? parseInt(retryAfter, 10) * 1000 : waitMs;
        if (Number.isFinite(wait) && wait > 0) {
          await new Promise((r) => setTimeout(r, Math.min(wait, 60_000)));
        }
        lastError = new Error(`HTTP ${res.status}`);
        continue;
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const body = await res.text();
      clearTimeout(timeoutId);
      return { body, finalUrl };
    } catch (err) {
      clearTimeout(timeoutId);
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_RETRIES - 1) {
        await new Promise((r) => setTimeout(r, waitMs));
        waitMs = Math.min(waitMs * 2, 15_000);
      }
    }
  }

  throw lastError ?? new Error("Fetch failed");
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  trimValues: true,
  alwaysCreateTextNode: true, // so elements with attributes (e.g. podcast:locked owner="...") still have text in #text
  isArray: (name) =>
    name === "item" ||
    name === "entry" ||
    name === "link" ||
    name === "category" ||
    name === "person" ||
    name === "funding",
});

function textOf(obj: unknown): string {
  if (obj == null) return "";
  if (typeof obj === "string") return obj.trim();
  if (typeof obj === "number") return String(obj).trim();
  if (typeof obj !== "object" || obj === null) return "";
  const o = obj as Record<string, unknown>;
  const t = o["#text"];
  if (typeof t === "string") return t.trim();
  if (typeof t === "number") return String(t).trim(); // parser can emit numeric #text (e.g. itunes:season)
  const u = o["_"];
  if (typeof u === "string") return u.trim();
  if (typeof u === "number") return String(u).trim();
  return "";
}

/** Get text from value that may be string, { '#text': string }, or array of those (e.g. when both title and itunes:title exist). */
function textOfAny(obj: unknown): string {
  return textOf(first(ensureArray(obj)));
}

/** Normalize date string so new Date() can parse it (e.g. replace &#43; with + in RFC 2822). */
function normalizeDateString(s: string | null): string | null {
  if (!s || typeof s !== "string") return null;
  const t = s.trim().replace(/&#43;/gi, "+");
  return t || null;
}

/**
 * Normalize description/summary text. Preserves newlines when stripping HTML.
 * @param html - Raw string (may be HTML or plain text).
 * @param preserveHtml - If true (e.g. content:encoded), only trim and normalize newlines (\\r\\n -> \\n). If false, strip HTML but keep line breaks.
 */
function normalizeDescription(html: string, preserveHtml: boolean): string {
  if (!html || typeof html !== "string") return "";
  let s = html.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (preserveHtml) return s;
  // Replace block/br with newline before stripping other tags, then collapse only horizontal whitespace
  s = s
    .replace(/<\s*\/?\s*(p|div|br|tr|li|h[1-6])\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return s;
}

function first<T>(arr: T[] | T | undefined): T | undefined {
  if (arr == null) return undefined;
  return Array.isArray(arr) ? arr[0] : arr;
}

function ensureArray<T>(arr: T[] | T | undefined): T[] {
  if (arr == null) return [];
  return Array.isArray(arr) ? arr : [arr];
}

/** Get link with rel="next" from channel or feed. Ignore rel="hub" and rel="self" for paging. */
function getNextPageUrl(
  channelOrFeed: Record<string, unknown>,
  baseUrl: string,
): string | null {
  const links = ensureArray(channelOrFeed["link"]);
  for (const link of links) {
    const l = link as Record<string, unknown>;
    const rel = (l["@_rel"] as string) ?? (l["rel"] as string) ?? "";
    if (String(rel).toLowerCase() === "next") {
      const href = (l["@_href"] as string) ?? (l["href"] as string) ?? "";
      if (href) return normalizeUrl(baseUrl, href);
    }
  }
  return null;
}

function parseExplicit(val: unknown): number {
  if (val == null) return 0;
  const s = String(val).toLowerCase();
  if (s === "yes" || s === "true" || s === "1") return 1;
  return 0;
}

function parseChannelMeta(
  channelOrFeed: Record<string, unknown>,
  baseUrl?: string,
): ImportChannelMeta {
  const title = textOfAny(channelOrFeed["title"]) || "Imported Podcast";
  const description = normalizeDescription(
    textOfAny(channelOrFeed["description"]) || "",
    false,
  );
  const subtitleRaw =
    textOfAny(channelOrFeed["itunes:subtitle"] ?? channelOrFeed["subtitle"]) ||
    "";
  const subtitle = subtitleRaw
    ? normalizeDescription(subtitleRaw, false)
    : null;
  const summaryRaw =
    textOfAny(channelOrFeed["itunes:summary"] ?? channelOrFeed["summary"]) ||
    "";
  const summary = summaryRaw ? normalizeDescription(summaryRaw, false) : null;
  const language =
    (
      textOfAny(channelOrFeed["language"]) ||
      textOf(channelOrFeed["@_xml:lang"] ?? channelOrFeed["xml:lang"] ?? "") ||
      "en"
    ).slice(0, 2) || "en";
  const author =
    textOfAny(channelOrFeed["author"]) ||
    textOfAny(channelOrFeed["itunes:author"]) ||
    "";
  const ownerBlock = channelOrFeed["itunes:owner"] ?? channelOrFeed["owner"];
  const ownerName =
    ownerBlock &&
    typeof ownerBlock === "object" &&
    ownerBlock !== null &&
    "name" in ownerBlock
      ? textOfAny((ownerBlock as Record<string, unknown>)["name"])
      : author;
  const ownerEmail =
    ownerBlock &&
    typeof ownerBlock === "object" &&
    ownerBlock !== null &&
    "email" in ownerBlock
      ? textOfAny((ownerBlock as Record<string, unknown>)["email"])
      : "";
  const link =
    textOf(first(ensureArray(channelOrFeed["link"]))) ||
    (channelOrFeed["link"] &&
    typeof (channelOrFeed["link"] as Record<string, unknown>)["@_href"] ===
      "string"
      ? String((channelOrFeed["link"] as Record<string, unknown>)["@_href"])
      : "");
  // With removeNSPrefix, itunes:category becomes "category". Flatten: each item's @_text, then nested category/category[] @_text.
  const rawCategoryList = ensureArray(
    channelOrFeed["itunes:category"] ?? channelOrFeed["category"],
  );
  const categories: string[] = [];
  for (const c of rawCategoryList) {
    const rec = c as Record<string, unknown>;
    const primary = textOf(rec["@_text"] ?? rec);
    if (primary) categories.push(primary);
    const nested = ensureArray(rec["category"]);
    for (const n of nested) {
      const nrec = n as Record<string, unknown>;
      const sub = textOf(nrec["@_text"] ?? n);
      if (sub) categories.push(sub);
    }
  }
  if (categories.length === 0) {
    const cat = textOfAny(channelOrFeed["category"]);
    if (cat) categories.push(cat);
  }
  console.log("[import] parseChannelMeta categories:", {
    rawKeys: {
      "itunes:category": channelOrFeed["itunes:category"] != null,
      category: channelOrFeed["category"] != null,
    },
    rawCategoryListLength: rawCategoryList.length,
    flattened: categories,
  });
  // With removeNSPrefix, itunes:image becomes "image". So we only have channel['image'] (may be itunes:image with @_href or <image> block with url child). Try both.
  const rawImage = channelOrFeed["itunes:image"] ?? channelOrFeed["image"];
  const image = first(ensureArray(rawImage));
  let artwork_url: string | null = null;
  if (image && typeof image === "object" && image !== null) {
    const rec = image as Record<string, unknown>;
    let raw =
      typeof rec["@_href"] === "string" && rec["@_href"].trim()
        ? rec["@_href"].trim()
        : null;
    if (!raw) raw = textOfAny(rec["url"])?.trim() || null;
    artwork_url = raw && baseUrl ? normalizeUrl(baseUrl, raw) : raw;
  }

  const podcastGuidRaw =
    textOfAny(channelOrFeed["podcast:guid"]) ||
    textOfAny(channelOrFeed["guid"]) ||
    null;
  const podcastGuid =
    podcastGuidRaw && podcastGuidRaw.trim() ? podcastGuidRaw.trim() : null;
  // With removeNSPrefix, podcast:locked becomes "locked". Check both.
  const lockedRaw = (
    textOfAny(channelOrFeed["podcast:locked"]) ||
    textOfAny(channelOrFeed["locked"]) ||
    ""
  ).toLowerCase();
  const locked =
    lockedRaw === "yes" || lockedRaw === "true" || lockedRaw === "1" ? 1 : 0;

  const fundingFirst = first(
    ensureArray(channelOrFeed["podcast:funding"] ?? channelOrFeed["funding"]),
  );
  let funding_url: string | null = null;
  let funding_label: string | null = null;
  if (
    fundingFirst &&
    typeof fundingFirst === "object" &&
    fundingFirst !== null
  ) {
    const rec = fundingFirst as Record<string, unknown>;
    const url = rec["@_url"];
    funding_url = typeof url === "string" && url.trim() ? url.trim() : null;
    funding_label = textOfAny(rec["#text"] ?? rec)?.trim() || null;
  }
  const personList = ensureArray(
    channelOrFeed["podcast:person"] ?? channelOrFeed["person"],
  );
  const personsArr = personList
    .map((p) => textOfAny(p))
    .filter((s) => s.length > 0);
  const persons = personsArr.length > 0 ? JSON.stringify(personsArr) : null;
  const updateFreq =
    channelOrFeed["podcast:updateFrequency"] ??
    channelOrFeed["updateFrequency"];
  let update_frequency_rrule: string | null = null;
  let update_frequency_label: string | null = null;
  if (updateFreq && typeof updateFreq === "object" && updateFreq !== null) {
    const rec = updateFreq as Record<string, unknown>;
    const rrule = rec["@_rrule"];
    update_frequency_rrule =
      typeof rrule === "string" && rrule.trim() ? rrule.trim() : null;
    update_frequency_label = textOfAny(rec["#text"] ?? rec)?.trim() || null;
  }
  const limitEl = channelOrFeed["spotify:limit"] ?? channelOrFeed["limit"];
  let spotify_recent_count: number | null = null;
  if (limitEl && typeof limitEl === "object" && limitEl !== null) {
    const rc = (limitEl as Record<string, unknown>)["@_recentCount"];
    if (rc != null) {
      const n = parseInt(String(rc), 10);
      if (Number.isInteger(n) && n >= 0) spotify_recent_count = n;
    }
  }
  const spotify_country_of_origin =
    textOfAny(
      channelOrFeed["spotify:countryOfOrigin"] ??
        channelOrFeed["countryOfOrigin"],
    )?.trim() || null;
  const apple_podcasts_verify =
    textOfAny(
      channelOrFeed["itunes:applepodcastsverify"] ??
        channelOrFeed["applepodcastsverify"],
    )?.trim() || null;

  return {
    title,
    description,
    subtitle,
    summary,
    language,
    author_name: author,
    owner_name: ownerName,
    email:
      ownerEmail ||
      textOfAny(channelOrFeed["managingEditor"]) ||
      textOfAny(channelOrFeed["webMaster"]) ||
      "",
    category_primary: categories[0] ?? "",
    category_secondary: categories[1] ?? null,
    category_primary_two: categories[2] ?? null,
    category_secondary_two: categories[3] ?? null,
    category_primary_three: categories[4] ?? null,
    category_secondary_three: categories[5] ?? null,
    explicit: parseExplicit(
      textOfAny(
        channelOrFeed["itunes:explicit"] ?? channelOrFeed["explicit"],
      ) ?? null,
    ),
    site_url: link && (link.startsWith("http") ? link : null) ? link : null,
    artwork_url,
    copyright:
      textOfAny(channelOrFeed["copyright"]) ||
      textOfAny(channelOrFeed["rights"]) ||
      null,
    license:
      textOfAny(channelOrFeed["podcast:license"]) ||
      textOfAny(channelOrFeed["license"]) ||
      null,
    itunes_type:
      (textOfAny(channelOrFeed["itunes:type"]) || "episodic").toLowerCase() ===
      "serial"
        ? "serial"
        : "episodic",
    medium: (
      textOfAny(channelOrFeed["itunes:medium"]) || "podcast"
    ).toLowerCase() as ImportChannelMeta["medium"],
    podcast_guid: podcastGuid,
    locked,
    funding_url,
    funding_label,
    persons,
    update_frequency_rrule,
    update_frequency_label,
    spotify_recent_count,
    spotify_country_of_origin,
    apple_podcasts_verify,
  };
}

function getEnclosure(
  item: Record<string, unknown>,
  baseUrl: string,
): { url: string; type: string } | null {
  const enclosures = ensureArray(item["enclosure"]);
  for (const enc of enclosures) {
    const e = enc as Record<string, unknown>;
    const url = (e["@_url"] as string) ?? (e["url"] as string);
    if (!url || typeof url !== "string") continue;
    const type = (
      (e["@_type"] as string) ??
      (e["type"] as string) ??
      ""
    ).toLowerCase();
    if (type.startsWith("audio/") || type.startsWith("video/")) {
      return { url: normalizeUrl(baseUrl, url), type };
    }
  }
  const firstEnc = first(enclosures) as Record<string, unknown> | undefined;
  if (firstEnc) {
    const url = (firstEnc["@_url"] as string) ?? (firstEnc["url"] as string);
    if (url && typeof url === "string") {
      const type =
        (firstEnc["@_type"] as string) ??
        (firstEnc["type"] as string) ??
        "audio/mpeg";
      return { url: normalizeUrl(baseUrl, url), type };
    }
  }
  return null;
}

function itemToEpisode(
  item: Record<string, unknown>,
  baseUrl: string,
): ImportEpisodeItem | null {
  const enclosure = getEnclosure(item, baseUrl);
  if (!enclosure) return null;

  const title =
    textOfAny(item["title"]) || textOfAny(item["media:title"]) || "Untitled";
  const descriptionRaw = textOfAny(item["description"]) || "";
  const description = descriptionRaw
    ? normalizeDescription(descriptionRaw, false)
    : "";
  const summaryRaw = textOfAny(item["itunes:summary"] ?? item["summary"]) || "";
  const summary = summaryRaw ? normalizeDescription(summaryRaw, false) : null;
  const contentEncodedRaw =
    item["content"] &&
    typeof item["content"] === "object" &&
    (item["content"] as Record<string, unknown>)["encoded"] != null
      ? textOfAny((item["content"] as Record<string, unknown>)["encoded"])
      : textOfAny(item["encoded"]) || "";
  const content_encoded = contentEncodedRaw
    ? normalizeDescription(contentEncodedRaw, true)
    : null;
  const subtitleRaw =
    textOfAny(item["itunes:subtitle"] ?? item["subtitle"]) || "";
  const subtitle = subtitleRaw
    ? normalizeDescription(subtitleRaw, false)
    : null;
  const guid = textOfAny(item["guid"]) || enclosure.url;
  const guidIsPermalink =
    item["guid"] &&
    typeof item["guid"] === "object" &&
    (item["guid"] as Record<string, unknown>)["@_isPermaLink"] === "false"
      ? 0
      : 1;
  const pubDateRaw =
    textOfAny(item["pubDate"]) ||
    textOfAny(item["published"]) ||
    textOfAny(item["updated"]) ||
    null;
  const pubDate = normalizeDateString(pubDateRaw);
  const seasonRaw = textOfAny(item["itunes:season"] ?? item["season"]) || "";
  const episodeRaw = textOfAny(item["itunes:episode"] ?? item["episode"]) || "";
  const season_number = seasonRaw !== "" ? parseInt(seasonRaw, 10) : null;
  const episode_number = episodeRaw !== "" ? parseInt(episodeRaw, 10) : null;
  const episodeTypeRaw =
    textOfAny(item["itunes:episodeType"]) ||
    textOfAny(item["episodeType"]) ||
    null;
  const episodeType = episodeTypeRaw ? episodeTypeRaw.toLowerCase() : null;
  const explicit = parseExplicit(item["itunes:explicit"] ?? item["explicit"]);
  const image = item["itunes:image"] ?? item["image"];
  let artwork_url: string | null = null;
  if (image && typeof image === "object" && image !== null) {
    const href =
      (image as Record<string, unknown>)["@_href"] ??
      (image as Record<string, unknown>)["url"];
    if (typeof href === "string") {
      const trimmed = href.trim();
      artwork_url = trimmed ? normalizeUrl(baseUrl, trimmed) : null;
    }
  }
  const link =
    textOfAny(item["link"]) ||
    (item["link"] && typeof item["link"] === "object"
      ? textOfAny((item["link"] as Record<string, unknown>)["@_href"])
      : "") ||
    null;

  return {
    title,
    description,
    subtitle,
    summary,
    content_encoded,
    guid: guid.trim() || enclosure.url,
    guidIsPermalink: guidIsPermalink as 0 | 1,
    enclosureUrl: enclosure.url,
    enclosureType: enclosure.type,
    pubDate: pubDate || null,
    season_number: Number.isInteger(season_number) ? season_number : null,
    episode_number: Number.isInteger(episode_number) ? episode_number : null,
    episode_type: episodeType,
    explicit: explicit === 0 ? 0 : 1,
    artwork_url,
    episode_link: link && link.startsWith("http") ? link : null,
  };
}

function extractItemsFromPage(
  parsed: Record<string, unknown>,
  baseUrl: string,
): { channel: Record<string, unknown>; items: ImportEpisodeItem[] } {
  const channel =
    ((parsed["rss"] as Record<string, unknown>)?.channel as Record<
      string,
      unknown
    >) ?? (parsed["feed"] as Record<string, unknown>);
  if (!channel) {
    return { channel: {}, items: [] };
  }

  const rawItems =
    ensureArray(channel["item"]).length > 0
      ? ensureArray(channel["item"])
      : ensureArray(channel["entry"]);
  const items: ImportEpisodeItem[] = [];
  for (const raw of rawItems) {
    const ep = itemToEpisode(raw as Record<string, unknown>, baseUrl);
    if (ep) items.push(ep);
  }
  return { channel, items };
}

function dedupeKey(ep: ImportEpisodeItem): string {
  return ep.guid || ep.enclosureUrl || `${ep.title}|${ep.pubDate ?? ""}`;
}

/**
 * Fetch feed at url, follow atom:link rel="next" until no next or duplicate/empty.
 * Returns channel metadata and episodes sorted by pubDate ascending (oldest first), deduped.
 */
export async function fetchAndParseFeed(
  feedUrl: string,
  signal?: AbortSignal,
): Promise<ImportFeedResult> {
  const controller = new AbortController();
  if (signal) {
    signal.addEventListener("abort", () => controller.abort());
  }

  const visitedPageUrls = new Set<string>();
  const seenKeys = new Set<string>();
  const allEpisodes: ImportEpisodeItem[] = [];
  let channelMeta: ImportChannelMeta | null = null;
  let currentUrl: string = feedUrl;
  let consecutiveEmptyPages = 0;

  while (true) {
    await assertUrlNotPrivate(currentUrl);
    const { body, finalUrl } = await fetchWithRetry(currentUrl, controller);
    visitedPageUrls.add(finalUrl);

    let parsed: Record<string, unknown>;
    try {
      parsed = parser.parse(body) as Record<string, unknown>;
    } catch (err) {
      throw new Error(
        "Invalid XML: " + (err instanceof Error ? err.message : String(err)),
      );
    }

    const { channel, items } = extractItemsFromPage(parsed, finalUrl);

    if (!channelMeta && channel && Object.keys(channel).length > 0) {
      channelMeta = parseChannelMeta(channel, finalUrl);
    }

    let newInPage = 0;
    for (const ep of items) {
      const key = dedupeKey(ep);
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      allEpisodes.push(ep);
      newInPage++;
    }

    if (newInPage === 0) {
      consecutiveEmptyPages++;
      if (consecutiveEmptyPages >= CONSECUTIVE_EMPTY_PAGES_STOP) break;
    } else {
      consecutiveEmptyPages = 0;
    }

    const nextUrl = channel ? getNextPageUrl(channel, finalUrl) : null;
    if (!nextUrl || visitedPageUrls.has(nextUrl)) break;
    await assertUrlNotPrivate(nextUrl);
    currentUrl = nextUrl;
  }

  if (!channelMeta) {
    channelMeta = {
      title: "Imported Podcast",
      description: "",
      subtitle: null,
      summary: null,
      language: "en",
      author_name: "",
      owner_name: "",
      email: "",
      category_primary: "",
      category_secondary: null,
      category_primary_two: null,
      category_secondary_two: null,
      category_primary_three: null,
      category_secondary_three: null,
      explicit: 0,
      site_url: null,
      artwork_url: null,
      copyright: null,
      license: null,
      itunes_type: "episodic",
      medium: "podcast",
      podcast_guid: null,
      locked: 0,
      funding_url: null,
      funding_label: null,
      persons: null,
      update_frequency_rrule: null,
      update_frequency_label: null,
      spotify_recent_count: null,
      spotify_country_of_origin: null,
      apple_podcasts_verify: null,
    };
  }

  const sorted = [...allEpisodes].sort((a, b) => {
    const da = a.pubDate ? new Date(a.pubDate).getTime() : 0;
    const db = b.pubDate ? new Date(b.pubDate).getTime() : 0;
    const ta = Number.isFinite(da) ? da : 0;
    const tb = Number.isFinite(db) ? db : 0;
    return ta - tb;
  });

  return { channel: channelMeta, episodes: sorted };
}
