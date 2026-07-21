/**
 * Fetch and parse RSS/Atom feeds for podcast import.
 * Uses fast-xml-parser 5.3.5. Handles pagination via atom:link rel="next",
 * dedupes by guid to enclosure url to (title + pubDate), returns oldest-first.
 */

import { XMLParser } from "fast-xml-parser";
import { IMPORT_USER_AGENT, IMPORT_FETCH_TIMEOUT_MS } from "../config.js";
import { assertUrlNotPrivate } from "../utils/ssrf.js";
const MAX_RETRIES = 3;
const CONSECUTIVE_EMPTY_PAGES_STOP = 2;

export interface ImportPersonRecord {
  name: string;
  role: string | null;
  href: string | null;
  img: string | null;
}

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
  license: string | null; // JSON string {"identifier","url?"} or null
  itunes_type: string;
  medium: string;
  podcast_guid: string | null;
  locked: number;
  funding_links: string | null; // JSON array
  persons: string | null;
  /** Structured channel <podcast:person> for cast creation. */
  person_records: ImportPersonRecord[];
  update_frequency: string | null; // JSON object
  podcast_txts: string | null;
  social_interacts: string | null;
  locations: string | null;
  chat: string | null;
  value_blocks: string | null;
  blocks: string | null;
  publisher: string | null;
  podroll: string | null;
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
  content_links: string | null;
  podcast_txts: string | null;
  social_interacts: string | null;
  locations: string | null;
  license: string | null;
  podcast_images: string | null;
  funding_links: string | null;
  chat: string | null;
  value_blocks: string | null;
  final_soundbites: string | null;
  chapters_url: string | null;
  transcript_url: string | null;
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

const ARRAY_TAG_NAMES = new Set([
  "item",
  "entry",
  "link",
  "category",
  "person",
  "funding",
  "txt",
  "block",
  "location",
  "socialInteract",
  "contentLink",
  "soundbite",
  "value",
  "valueRecipient",
  "image",
  "remoteItem",
  "transcript",
  "chapters",
]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  trimValues: true,
  alwaysCreateTextNode: true, // so elements with attributes (e.g. podcast:locked owner="...") still have text in #text
  isArray: (name) => ARRAY_TAG_NAMES.has(name),
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

function attrString(rec: Record<string, unknown>, key: string): string {
  const v = rec[key];
  return typeof v === "string" && v.trim() ? v.trim() : "";
}

function jsonOrNull(arr: unknown[]): string | null {
  return arr.length > 0 ? JSON.stringify(arr) : null;
}

// ---------------------------------------------------------------------------
// Shared Podcast 2.0 parsers (channel + item)
// ---------------------------------------------------------------------------

function parseFundingLinks(parent: Record<string, unknown>): string | null {
  const list = ensureArray(parent["podcast:funding"] ?? parent["funding"]);
  const out: Array<{ url: string; text: string | null }> = [];
  for (const fundingEl of list) {
    if (!fundingEl || typeof fundingEl !== "object") continue;
    const rec = fundingEl as Record<string, unknown>;
    const href = attrString(rec, "@_url");
    if (!href) continue;
    out.push({
      url: href,
      text: textOfAny(rec["#text"] ?? rec)?.trim() || null,
    });
  }
  return jsonOrNull(out);
}

function parseTxts(parent: Record<string, unknown>): string | null {
  const list = ensureArray(parent["podcast:txt"] ?? parent["txt"]);
  const out: Array<{ purpose: string | null; value: string }> = [];
  for (const el of list) {
    if (el == null) continue;
    if (typeof el === "object") {
      const rec = el as Record<string, unknown>;
      const value = textOfAny(rec["#text"] ?? rec)?.trim() || "";
      if (!value) continue;
      const purpose = attrString(rec, "@_purpose") || null;
      out.push({ purpose, value });
    } else {
      const value = String(el).trim();
      if (value) out.push({ purpose: null, value });
    }
  }
  return jsonOrNull(out);
}

function parseSocialInteracts(parent: Record<string, unknown>): string | null {
  const list = ensureArray(
    parent["podcast:socialInteract"] ?? parent["socialInteract"],
  );
  const out: Array<Record<string, unknown>> = [];
  for (const el of list) {
    if (!el || typeof el !== "object") continue;
    const rec = el as Record<string, unknown>;
    const protocol = attrString(rec, "@_protocol");
    if (!protocol) continue;
    const item: Record<string, unknown> = { protocol };
    if (attrString(rec, "@_uri")) item.uri = attrString(rec, "@_uri");
    if (attrString(rec, "@_accountId"))
      item.accountId = attrString(rec, "@_accountId");
    if (attrString(rec, "@_accountUrl"))
      item.accountUrl = attrString(rec, "@_accountUrl");
    if (rec["@_priority"] != null) {
      const n = parseInt(String(rec["@_priority"]), 10);
      if (Number.isFinite(n)) item.priority = n;
    }
    out.push(item);
  }
  return jsonOrNull(out);
}

function parseLocations(parent: Record<string, unknown>): string | null {
  const list = ensureArray(parent["podcast:location"] ?? parent["location"]);
  const out: Array<Record<string, unknown>> = [];
  for (const el of list) {
    if (!el || typeof el !== "object") continue;
    const rec = el as Record<string, unknown>;
    const name = textOfAny(rec["#text"] ?? rec)?.trim() || "";
    if (!name) continue;
    const item: Record<string, unknown> = { name: name.slice(0, 128) };
    const rel = attrString(rec, "@_rel");
    if (rel === "subject" || rel === "creator") item.rel = rel;
    if (attrString(rec, "@_geo")) item.geo = attrString(rec, "@_geo");
    if (attrString(rec, "@_osm")) item.osm = attrString(rec, "@_osm");
    const country = attrString(rec, "@_country");
    if (/^[A-Za-z]{2}$/.test(country)) item.country = country.toUpperCase();
    out.push(item);
  }
  return jsonOrNull(out);
}

function parseBlocks(parent: Record<string, unknown>): string | null {
  const list = ensureArray(parent["podcast:block"] ?? parent["block"]);
  const out: Array<{ id: string | null; value: "yes" | "no" }> = [];
  for (const el of list) {
    let valueRaw = "";
    let id: string | null = null;
    if (typeof el === "object" && el !== null) {
      const rec = el as Record<string, unknown>;
      valueRaw = textOfAny(rec["#text"] ?? rec)?.trim().toLowerCase() || "";
      if (attrString(rec, "@_id")) id = attrString(rec, "@_id");
    } else {
      valueRaw = String(el).trim().toLowerCase();
    }
    if (valueRaw !== "yes" && valueRaw !== "no") continue;
    out.push({ id, value: valueRaw });
  }
  return jsonOrNull(out);
}

function parseChat(parent: Record<string, unknown>): string | null {
  const chatEl = parent["podcast:chat"] ?? parent["chat"];
  const firstChat = first(ensureArray(chatEl));
  if (!firstChat || typeof firstChat !== "object") return null;
  const rec = firstChat as Record<string, unknown>;
  const server = attrString(rec, "@_server");
  const protocol = attrString(rec, "@_protocol");
  if (!server || !protocol) return null;
  return JSON.stringify({
    server,
    protocol,
    accountId: attrString(rec, "@_accountId") || null,
    space: attrString(rec, "@_space") || null,
  });
}

function parseLicense(parent: Record<string, unknown>): string | null {
  const licenseEl = parent["podcast:license"] ?? parent["license"];
  if (licenseEl == null) return null;
  let identifier = "";
  let url: string | null = null;
  if (typeof licenseEl === "object" && licenseEl !== null) {
    const rec = licenseEl as Record<string, unknown>;
    identifier = textOfAny(rec["#text"] ?? rec)?.trim() || "";
    url = attrString(rec, "@_url") || null;
  } else {
    identifier = textOfAny(licenseEl)?.trim() || "";
  }
  if (!identifier) return null;
  return JSON.stringify({ identifier: identifier.slice(0, 128), url });
}

function parseValueBlocks(parent: Record<string, unknown>): string | null {
  const list = ensureArray(parent["podcast:value"] ?? parent["value"]);
  const out: Array<{
    type: string;
    method: string;
    suggested: string | null;
    recipients: Array<{
      type: string;
      address: string;
      split: number;
      name: string | null;
      customKey: string | null;
      customValue: string | null;
      fee: boolean | null;
    }>;
  }> = [];
  for (const el of list) {
    if (!el || typeof el !== "object") continue;
    const rec = el as Record<string, unknown>;
    const type = attrString(rec, "@_type");
    const method = attrString(rec, "@_method");
    if (!type || !method) continue;
    const recipientsRaw = ensureArray(
      rec["podcast:valueRecipient"] ?? rec["valueRecipient"],
    );
    const recipients: Array<{
      type: string;
      address: string;
      split: number;
      name: string | null;
      customKey: string | null;
      customValue: string | null;
      fee: boolean | null;
    }> = [];
    for (const rEl of recipientsRaw) {
      if (!rEl || typeof rEl !== "object") continue;
      const r = rEl as Record<string, unknown>;
      const rType = attrString(r, "@_type");
      const address = attrString(r, "@_address");
      const splitN = parseInt(String(r["@_split"] ?? ""), 10);
      if (!rType || !address || !Number.isFinite(splitN) || splitN < 0) continue;
      const feeRaw = String(r["@_fee"] ?? "").toLowerCase();
      recipients.push({
        type: rType,
        address,
        split: Math.floor(splitN),
        name: attrString(r, "@_name") || null,
        customKey: attrString(r, "@_customKey") || null,
        customValue: attrString(r, "@_customValue") || null,
        fee: feeRaw === "true" || feeRaw === "1" || feeRaw === "yes" ? true : null,
      });
    }
    if (recipients.length === 0) continue;
    out.push({
      type,
      method,
      suggested: attrString(rec, "@_suggested") || null,
      recipients,
    });
  }
  return jsonOrNull(out);
}

function parseContentLinks(parent: Record<string, unknown>): string | null {
  const list = ensureArray(
    parent["podcast:contentLink"] ?? parent["contentLink"],
  );
  const out: Array<{ href: string; text: string | null }> = [];
  for (const el of list) {
    if (!el || typeof el !== "object") continue;
    const rec = el as Record<string, unknown>;
    const href = attrString(rec, "@_href");
    if (!href) continue;
    const text = textOfAny(rec["#text"] ?? rec)?.trim() || null;
    out.push({ href, text });
  }
  return jsonOrNull(out);
}

function parsePodcastImages(
  parent: Record<string, unknown>,
  baseUrl?: string,
): string | null {
  const list = ensureArray(parent["podcast:image"] ?? parent["image"]);
  const out: Array<{
    href: string;
    alt: string | null;
    aspectRatio: string | null;
    width: number | null;
    height: number | null;
    type: string | null;
    purpose: string | null;
  }> = [];
  for (const el of list) {
    if (!el || typeof el !== "object") continue;
    const rec = el as Record<string, unknown>;
    // Skip RSS <image><url>… blocks (no @_href)
    const rawHref = attrString(rec, "@_href");
    if (!rawHref) continue;
    const alt = attrString(rec, "@_alt");
    const aspectRatio =
      attrString(rec, "@_aspect-ratio") || attrString(rec, "@_aspectRatio");
    const type = attrString(rec, "@_type");
    const purpose = attrString(rec, "@_purpose");
    const widthRaw = rec["@_width"];
    const heightRaw = rec["@_height"];
    const width =
      widthRaw != null ? parseInt(String(widthRaw), 10) : Number.NaN;
    const height =
      heightRaw != null ? parseInt(String(heightRaw), 10) : Number.NaN;
    // itunes:image is typically href-only; keep those for artwork, not podcast_images
    const hasPodcastAttrs =
      !!alt ||
      !!aspectRatio ||
      !!type ||
      !!purpose ||
      (Number.isFinite(width) && width > 0) ||
      (Number.isFinite(height) && height > 0);
    if (!hasPodcastAttrs) continue;
    const href = baseUrl ? normalizeUrl(baseUrl, rawHref) : rawHref;
    out.push({
      href,
      alt: alt || null,
      aspectRatio: aspectRatio || null,
      width: Number.isFinite(width) && width > 0 ? width : null,
      height: Number.isFinite(height) && height > 0 ? height : null,
      type: type || null,
      purpose: purpose || null,
    });
  }
  return jsonOrNull(out);
}

function parseSoundbites(parent: Record<string, unknown>): string | null {
  const list = ensureArray(parent["podcast:soundbite"] ?? parent["soundbite"]);
  const out: Array<{ time: number; duration: number; title?: string }> = [];
  for (const el of list) {
    if (!el || typeof el !== "object") continue;
    const rec = el as Record<string, unknown>;
    const start = parseFloat(String(rec["@_startTime"] ?? ""));
    if (!Number.isFinite(start) || start < 0) continue;
    let duration = parseFloat(String(rec["@_duration"] ?? "30"));
    if (!Number.isFinite(duration)) duration = 30;
    if (duration < 15) duration = 15;
    if (duration > 120) duration = 120;
    const title = textOfAny(rec["#text"] ?? rec)?.trim() || "";
    const item: { time: number; duration: number; title?: string } = {
      time: start,
      duration,
    };
    if (title) item.title = title.slice(0, 127);
    out.push(item);
  }
  return jsonOrNull(out);
}

function parsePersonRecords(
  parent: Record<string, unknown>,
): ImportPersonRecord[] {
  const list = ensureArray(parent["podcast:person"] ?? parent["person"]);
  const out: ImportPersonRecord[] = [];
  for (const el of list) {
    if (el == null) continue;
    const name =
      typeof el === "object"
        ? textOfAny((el as Record<string, unknown>)["#text"] ?? el)
        : String(el).trim();
    if (!name) continue;
    if (typeof el === "object" && el !== null) {
      const rec = el as Record<string, unknown>;
      out.push({
        name: name.slice(0, 128),
        role: attrString(rec, "@_role") || null,
        href: attrString(rec, "@_href") || null,
        img: attrString(rec, "@_img") || null,
      });
    } else {
      out.push({ name: name.slice(0, 128), role: null, href: null, img: null });
    }
  }
  return out;
}

function parseChaptersUrl(
  parent: Record<string, unknown>,
  baseUrl: string,
): string | null {
  const el = first(
    ensureArray(parent["podcast:chapters"] ?? parent["chapters"]),
  );
  if (!el || typeof el !== "object") return null;
  const url = attrString(el as Record<string, unknown>, "@_url");
  return url ? normalizeUrl(baseUrl, url) : null;
}

function parseTranscriptUrl(
  parent: Record<string, unknown>,
  baseUrl: string,
): string | null {
  const list = ensureArray(
    parent["podcast:transcript"] ?? parent["transcript"],
  );
  for (const el of list) {
    if (!el || typeof el !== "object") continue;
    const rec = el as Record<string, unknown>;
    const url = attrString(rec, "@_url");
    if (!url) continue;
    const type = attrString(rec, "@_type").toLowerCase();
    if (!type || type.includes("srt") || type.includes("text/plain")) {
      return normalizeUrl(baseUrl, url);
    }
  }
  const firstEl = first(list);
  if (firstEl && typeof firstEl === "object") {
    const url = attrString(firstEl as Record<string, unknown>, "@_url");
    if (url) return normalizeUrl(baseUrl, url);
  }
  return null;
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

/**
 * Channel website URL: prefer RSS text `<link>`, then `<atom:link href>`
 * (rel=alternate / empty, then any href that is not self/hub/pagination).
 * With removeNSPrefix, atom:link is also keyed as "link".
 */
function resolveChannelHomeUrl(channelOrFeed: Record<string, unknown>): string {
  const links = [
    ...ensureArray(channelOrFeed["link"]),
    ...ensureArray(channelOrFeed["atom:link"]),
  ];

  for (const link of links) {
    const text = textOf(link);
    if (text.startsWith("http")) return text;
  }

  const hrefOf = (link: unknown): string => {
    if (!link || typeof link !== "object") return "";
    const l = link as Record<string, unknown>;
    const href =
      (typeof l["@_href"] === "string" && l["@_href"]) ||
      (typeof l["href"] === "string" && l["href"]) ||
      "";
    return href.trim();
  };
  const relOf = (link: unknown): string => {
    if (!link || typeof link !== "object") return "";
    const l = link as Record<string, unknown>;
    const rel =
      (typeof l["@_rel"] === "string" && l["@_rel"]) ||
      (typeof l["rel"] === "string" && l["rel"]) ||
      "";
    return rel.trim().toLowerCase();
  };

  for (const link of links) {
    const href = hrefOf(link);
    if (!href.startsWith("http")) continue;
    const rel = relOf(link);
    if (rel === "alternate" || rel === "") return href;
  }

  const skipRels = new Set([
    "self",
    "hub",
    "next",
    "prev",
    "previous",
    "first",
    "last",
    "enclosure",
  ]);
  for (const link of links) {
    const href = hrefOf(link);
    if (!href.startsWith("http")) continue;
    if (!skipRels.has(relOf(link))) return href;
  }

  return "";
}

function parseExplicit(val: unknown): number {
  if (val == null) return 0;
  const s = String(val).toLowerCase();
  if (s === "yes" || s === "true" || s === "1") return 1;
  return 0;
}

function emptyChannelMeta(): ImportChannelMeta {
  return {
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
    funding_links: null,
    persons: null,
    person_records: [],
    update_frequency: null,
    podcast_txts: null,
    social_interacts: null,
    locations: null,
    chat: null,
    value_blocks: null,
    blocks: null,
    publisher: null,
    podroll: null,
    spotify_recent_count: null,
    spotify_country_of_origin: null,
    apple_podcasts_verify: null,
  };
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
  const link = resolveChannelHomeUrl(channelOrFeed);
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
  // With removeNSPrefix, itunes:image becomes "image". Prefer @_href (itunes), else <url> child (RSS image).
  const rawImage = channelOrFeed["itunes:image"] ?? channelOrFeed["image"];
  const imageList = ensureArray(rawImage);
  let artwork_url: string | null = null;
  for (const image of imageList) {
    if (!image || typeof image !== "object") continue;
    const rec = image as Record<string, unknown>;
    let raw =
      typeof rec["@_href"] === "string" && rec["@_href"].trim()
        ? rec["@_href"].trim()
        : null;
    if (!raw) raw = textOfAny(rec["url"])?.trim() || null;
    if (raw) {
      artwork_url = baseUrl ? normalizeUrl(baseUrl, raw) : raw;
      break;
    }
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

  const funding_links = parseFundingLinks(channelOrFeed);
  const person_records = parsePersonRecords(channelOrFeed);
  const personsArr = person_records.map((p) => p.name);
  const persons = personsArr.length > 0 ? JSON.stringify(personsArr) : null;

  const updateFreq =
    channelOrFeed["podcast:updateFrequency"] ??
    channelOrFeed["updateFrequency"];
  let update_frequency: string | null = null;
  if (updateFreq && typeof updateFreq === "object" && updateFreq !== null) {
    const firstUf = first(ensureArray(updateFreq));
    if (firstUf && typeof firstUf === "object") {
      const rec = firstUf as Record<string, unknown>;
      const rrule = attrString(rec, "@_rrule");
      const dtstart = attrString(rec, "@_dtstart");
      const completeRaw = String(rec["@_complete"] ?? "").toLowerCase();
      const complete =
        completeRaw === "true" || completeRaw === "1" || completeRaw === "yes";
      const label = textOfAny(rec["#text"] ?? rec)?.trim() || "";
      if (rrule || dtstart || complete || label) {
        update_frequency = JSON.stringify({
          rrule: rrule || null,
          label: label ? label.slice(0, 128) : null,
          complete: complete || null,
          dtstart: dtstart || null,
        });
      }
    }
  }

  const license = parseLicense(channelOrFeed);

  let publisher: string | null = null;
  {
    const pubEl = channelOrFeed["podcast:publisher"] ?? channelOrFeed["publisher"];
    const firstPub = first(ensureArray(pubEl));
    if (firstPub && typeof firstPub === "object") {
      const rec = firstPub as Record<string, unknown>;
      const remote =
        first(ensureArray(rec["podcast:remoteItem"] ?? rec["remoteItem"])) ??
        first(ensureArray(rec["remoteItem"]));
      if (remote && typeof remote === "object") {
        const r = remote as Record<string, unknown>;
        const feedGuid = attrString(r, "@_feedGuid");
        if (feedGuid) {
          publisher = JSON.stringify({
            feedGuid,
            feedUrl: attrString(r, "@_feedUrl") || null,
            medium: attrString(r, "@_medium") || "publisher",
          });
        }
      }
    }
  }

  let podroll: string | null = null;
  {
    const rollEl = channelOrFeed["podcast:podroll"] ?? channelOrFeed["podroll"];
    const firstRoll = first(ensureArray(rollEl));
    const remotes =
      firstRoll && typeof firstRoll === "object"
        ? ensureArray(
            (firstRoll as Record<string, unknown>)["podcast:remoteItem"] ??
              (firstRoll as Record<string, unknown>)["remoteItem"],
          )
        : ensureArray(rollEl);
    const items: Array<{
      feedGuid: string;
      feedUrl: string | null;
      title: string | null;
      coverArtUrl: string | null;
      homeUrl: string | null;
    }> = [];
    for (const remote of remotes) {
      if (!remote || typeof remote !== "object") continue;
      const r = remote as Record<string, unknown>;
      const feedGuid = attrString(r, "@_feedGuid");
      if (!feedGuid) continue;
      items.push({
        feedGuid,
        feedUrl: attrString(r, "@_feedUrl") || null,
        title: attrString(r, "@_title") || null,
        coverArtUrl: null,
        homeUrl: null,
      });
    }
    if (items.length > 0) podroll = JSON.stringify(items);
  }

  const podcast_txts = parseTxts(channelOrFeed);
  const social_interacts = parseSocialInteracts(channelOrFeed);
  const locations = parseLocations(channelOrFeed);
  const blocks = parseBlocks(channelOrFeed);
  const chat = parseChat(channelOrFeed);
  const value_blocks = parseValueBlocks(channelOrFeed);

  const limitEl = channelOrFeed["spotify:limit"] ?? channelOrFeed["limit"];
  let spotify_recent_count: number | null = null;
  if (limitEl && typeof limitEl === "object" && limitEl !== null) {
    const firstLimit = first(ensureArray(limitEl));
    if (firstLimit && typeof firstLimit === "object") {
      const rc = (firstLimit as Record<string, unknown>)["@_recentCount"];
      if (rc != null) {
        const n = parseInt(String(rc), 10);
        if (Number.isInteger(n) && n >= 0) spotify_recent_count = n;
      }
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
    license,
    itunes_type:
      (textOfAny(channelOrFeed["itunes:type"]) || "episodic").toLowerCase() ===
      "serial"
        ? "serial"
        : "episodic",
    medium: (
      textOfAny(channelOrFeed["podcast:medium"]) ||
      textOfAny(channelOrFeed["itunes:medium"]) ||
      "podcast"
    ).toLowerCase() as ImportChannelMeta["medium"],
    podcast_guid: podcastGuid,
    locked,
    funding_links,
    persons,
    person_records,
    update_frequency,
    podcast_txts,
    social_interacts,
    locations,
    chat,
    value_blocks,
    blocks,
    publisher,
    podroll,
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
  // Prefer podcast:season / podcast:episode when present (HarborFM emits both).
  const seasonRaw =
    textOfAny(item["podcast:season"] ?? item["season"]) ||
    textOfAny(item["itunes:season"]) ||
    "";
  const episodeRaw =
    textOfAny(item["podcast:episode"] ?? item["episode"]) ||
    textOfAny(item["itunes:episode"]) ||
    "";
  const season_number = seasonRaw !== "" ? parseInt(seasonRaw, 10) : null;
  const episode_number = episodeRaw !== "" ? parseInt(episodeRaw, 10) : null;
  const episodeTypeRaw =
    textOfAny(item["itunes:episodeType"]) ||
    textOfAny(item["episodeType"]) ||
    null;
  const episodeType = episodeTypeRaw ? episodeTypeRaw.toLowerCase() : null;
  const explicit = parseExplicit(item["itunes:explicit"] ?? item["explicit"]);

  // Artwork: first href-only image (itunes-style); podcast:image with attrs go to podcast_images
  const imageList = ensureArray(item["itunes:image"] ?? item["image"]);
  let artwork_url: string | null = null;
  for (const image of imageList) {
    if (!image || typeof image !== "object") continue;
    const rec = image as Record<string, unknown>;
    const href =
      (typeof rec["@_href"] === "string" && rec["@_href"].trim()) ||
      (typeof rec["url"] === "string" && rec["url"].trim()) ||
      "";
    if (!href) continue;
    const hasPodcastAttrs =
      !!attrString(rec, "@_alt") ||
      !!attrString(rec, "@_aspect-ratio") ||
      !!attrString(rec, "@_aspectRatio") ||
      !!attrString(rec, "@_type") ||
      !!attrString(rec, "@_purpose") ||
      rec["@_width"] != null ||
      rec["@_height"] != null;
    if (hasPodcastAttrs) continue;
    artwork_url = normalizeUrl(baseUrl, href);
    break;
  }

  const links = ensureArray(item["link"]);
  let link = "";
  for (const l of links) {
    const text = textOf(l);
    if (text.startsWith("http")) {
      link = text;
      break;
    }
    if (l && typeof l === "object") {
      const href = attrString(l as Record<string, unknown>, "@_href");
      if (href.startsWith("http")) {
        link = href;
        break;
      }
    }
  }

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
    content_links: parseContentLinks(item),
    podcast_txts: parseTxts(item),
    social_interacts: parseSocialInteracts(item),
    locations: parseLocations(item),
    license: parseLicense(item),
    podcast_images: parsePodcastImages(item, baseUrl),
    funding_links: parseFundingLinks(item),
    chat: parseChat(item),
    value_blocks: parseValueBlocks(item),
    final_soundbites: parseSoundbites(item),
    chapters_url: parseChaptersUrl(item, baseUrl),
    transcript_url: parseTranscriptUrl(item, baseUrl),
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
 * Parse a single RSS/Atom XML document (no network). Used by import and unit tests.
 */
export function parseFeedXml(xml: string, baseUrl = "https://example.com/"): ImportFeedResult {
  let parsed: Record<string, unknown>;
  try {
    parsed = parser.parse(xml) as Record<string, unknown>;
  } catch (err) {
    throw new Error(
      "Invalid XML: " + (err instanceof Error ? err.message : String(err)),
    );
  }
  const { channel, items } = extractItemsFromPage(parsed, baseUrl);
  const channelMeta =
    channel && Object.keys(channel).length > 0
      ? parseChannelMeta(channel, baseUrl)
      : emptyChannelMeta();
  const sorted = [...items].sort((a, b) => {
    const da = a.pubDate ? new Date(a.pubDate).getTime() : 0;
    const db = b.pubDate ? new Date(b.pubDate).getTime() : 0;
    const ta = Number.isFinite(da) ? da : 0;
    const tb = Number.isFinite(db) ? db : 0;
    return ta - tb;
  });
  return { channel: channelMeta, episodes: sorted };
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

    let channel: Record<string, unknown>;
    let items: ImportEpisodeItem[];
    try {
      const parsed = parser.parse(body) as Record<string, unknown>;
      ({ channel, items } = extractItemsFromPage(parsed, finalUrl));
    } catch (err) {
      throw new Error(
        "Invalid XML: " + (err instanceof Error ? err.message : String(err)),
      );
    }

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
    channelMeta = emptyChannelMeta();
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

/**
 * SSRF-safe fetch of a text URL (chapters.json, transcript.srt).
 */
export async function fetchImportTextUrl(
  url: string,
  signal?: AbortSignal,
): Promise<string> {
  const controller = new AbortController();
  if (signal) {
    signal.addEventListener("abort", () => controller.abort());
  }
  await assertUrlNotPrivate(url);
  const { body } = await fetchWithRetry(url, controller);
  return body;
}

/**
 * Parse Podcast 2.0 chapters JSON into HarborFM final_markers shape.
 */
export function parsePodcastChaptersJson(
  body: string,
): Array<{ time: number; title?: string }> | null {
  try {
    const parsed = JSON.parse(body) as {
      chapters?: Array<{ startTime?: unknown; title?: unknown }>;
    };
    if (!parsed || !Array.isArray(parsed.chapters)) return null;
    const markers: Array<{ time: number; title?: string }> = [];
    for (const ch of parsed.chapters) {
      const t =
        typeof ch.startTime === "number"
          ? ch.startTime
          : parseFloat(String(ch.startTime ?? ""));
      if (!Number.isFinite(t) || t < 0) continue;
      const title =
        typeof ch.title === "string" && ch.title.trim()
          ? ch.title.trim()
          : undefined;
      markers.push(title ? { time: t, title } : { time: t });
    }
    return markers.length > 0 ? markers : null;
  } catch {
    return null;
  }
}

export interface FeedChannelPreview {
  feedGuid: string | null;
  feedUrl: string;
  title: string;
  coverArtUrl: string | null;
  homeUrl: string | null;
}

/**
 * Fetch a single feed page (no pagination) and return channel fields for podroll autofill.
 */
export async function previewFeedChannel(
  feedUrl: string,
  signal?: AbortSignal,
): Promise<FeedChannelPreview> {
  const controller = new AbortController();
  if (signal) {
    signal.addEventListener("abort", () => controller.abort());
  }
  await assertUrlNotPrivate(feedUrl);
  const { body, finalUrl } = await fetchWithRetry(feedUrl, controller);
  let parsed: Record<string, unknown>;
  try {
    parsed = parser.parse(body) as Record<string, unknown>;
  } catch (err) {
    throw new Error(
      "Invalid XML: " + (err instanceof Error ? err.message : String(err)),
    );
  }
  const { channel } = extractItemsFromPage(parsed, finalUrl);
  if (!channel || Object.keys(channel).length === 0) {
    throw new Error("Feed has no channel metadata");
  }
  const meta = parseChannelMeta(channel, finalUrl);
  return {
    feedGuid: meta.podcast_guid,
    feedUrl: finalUrl || feedUrl,
    title: meta.title,
    coverArtUrl: meta.artwork_url,
    homeUrl: meta.site_url,
  };
}
