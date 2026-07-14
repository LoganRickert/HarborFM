import {
  existsSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { basename, extname, join } from "path";
import { drizzleDb } from "../db/index.js";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { episodes, exports, podcastCast, podcasts, settings } from "../db/schema.js";
import { getExportPathPrefix } from "./export-config.js";
import {
  assertPathUnder,
  assertResolvedPathUnder,
  castPhotoDir,
  chaptersJsonPath,
  getDataDir,
  processedDir,
  resolveDataPath,
  rssDir,
} from "./paths.js";
import { EXT_DOT_TO_EXT } from "../utils/artwork.js";
import { API_PREFIX, APP_NAME, RSS_FEED_FILENAME } from "../config.js";
import { getCanonicalFeedUrl } from "./dns/custom-domain-resolver.js";
import { readSettings } from "../modules/settings/index.js";

/** Placeholder in token feed template XML; replaced with token id when serving. */
export const SUBSCRIBER_TOKEN_ID_PLACEHOLDER = "{{SUBSCRIBER_TOKEN_ID}}";

/** Filename for the private (tokenized) feed template cache. */
export const PRIVATE_FEED_TEMPLATE_FILENAME = "private-feed-template.xml";

export interface GenerateRssOptions {
  /** Include subscriber-only episodes (for token feed). Default false = public only. */
  includeSubscriberOnlyEpisodes?: boolean;
  /** When set, build feed/enclosure/artwork/transcript URLs with this token id (or placeholder). */
  tokenIdPlaceholder?: string;
}

function artworkExt(artworkPath: string | null | undefined): string {
  if (!artworkPath) return "jpg";
  const ext = extname(String(artworkPath)).toLowerCase();
  return EXT_DOT_TO_EXT[ext] ?? "jpg";
}

/** Extension for enclosure URLs (e.g. .mp3, .m4a), from episode audio path or default .mp3 */
function enclosureExt(audioFinalPath: unknown): string {
  if (
    audioFinalPath == null ||
    typeof audioFinalPath !== "string" ||
    !audioFinalPath.trim()
  )
    return ".mp3";
  const ext = extname(audioFinalPath.trim());
  return ext || ".mp3";
}

/** Public enclosure URL for an episode (same rules as RSS item <enclosure>). */
function episodeEnclosureUrl(
  ep: { id: unknown; audioFinalPath: unknown },
  opts: {
    publicBaseNoSlash: string;
    podcastId: string;
    slugEnc: string;
    slugRaw: string;
    tokenIdPlaceholder?: string;
    exportPrefix: string | null;
  },
): string {
  const { publicBaseNoSlash, podcastId, slugEnc, slugRaw, tokenIdPlaceholder, exportPrefix } =
    opts;
  if (!publicBaseNoSlash || !ep.id) return "";
  const validEpisodeId = String(ep.id).trim();
  if (!validEpisodeId) return "";
  const ext = enclosureExt(ep.audioFinalPath);
  if (tokenIdPlaceholder && slugRaw) {
    return `${publicBaseNoSlash}/${API_PREFIX}/public/podcasts/${slugEnc}/private/${tokenIdPlaceholder}/episodes/${encodeURIComponent(validEpisodeId)}${ext}`;
  }
  if (exportPrefix != null) {
    return `${publicBaseNoSlash}/${exportPrefix}/episodes/${validEpisodeId}${ext}`;
  }
  if (ep.audioFinalPath && podcastId) {
    const validPodcastId = String(podcastId).trim();
    if (validPodcastId) {
      return `${publicBaseNoSlash}/${API_PREFIX}/${encodeURIComponent(validPodcastId)}/episodes/${encodeURIComponent(validEpisodeId)}${ext}`;
    }
  }
  return "";
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function escapeCdata(s: string): string {
  return s.replace(/\]\]>/g, "]]]]><![CDATA[>");
}

function stripControlChars(s: string): string {
  // Keep it "plain text": remove control chars (incl. newlines) that can break XML.
  return s.replace(/[\u0000-\u001F\u007F]/g, ""); // eslint-disable-line no-control-regex
}

/**
 * "Good enough" URL sanitizer for RSS output:
 * - absolute URLs only
 * - protocol must be http/https
 * - strip control characters
 * - reject credentials (user:pass@host) to avoid leaking secrets into feeds
 */
function sanitizeHttpUrl(input: unknown): string {
  if (typeof input !== "string") return "";
  const raw = stripControlChars(input).trim();
  if (!raw) return "";
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    if (u.username || u.password) return "";
    return u.toString();
  } catch {
    return "";
  }
}

function getSetting(key: string): string | null {
  const row = drizzleDb
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, key))
    .limit(1)
    .get();
  return row?.value ?? null;
}

/**
 * Atom rel="self" href: same path as rssFeedUrl but HTTPS root from linked/managed DNS
 * when enabled, otherwise the primary rssFeedUrl (app host or export).
 */
function atomLinkSelfHref(params: {
  rssFeedUrl: string;
  exportPrefix: string | null;
  podcast: {
    linkDomain?: string | null;
    managedDomain?: string | null;
    managedSubDomain?: string | null;
  };
  slugEnc: string;
  slugRaw: string;
  tokenIdPlaceholder?: string;
}): string {
  const {
    rssFeedUrl,
    exportPrefix,
    podcast,
    slugEnc,
    slugRaw,
    tokenIdPlaceholder,
  } = params;
  if (!rssFeedUrl || exportPrefix != null) return rssFeedUrl;

  const canonicalRoot = getCanonicalFeedUrl(podcast, readSettings());
  if (!canonicalRoot) return rssFeedUrl;
  const canonicalNoSlash =
    sanitizeHttpUrl(canonicalRoot.replace(/\/$/, ""))?.replace(/\/+$/, "") ??
    "";
  if (!canonicalNoSlash || !slugRaw) return rssFeedUrl;
  if (tokenIdPlaceholder) {
    return `${canonicalNoSlash}/${API_PREFIX}/public/podcasts/${slugEnc}/private/${tokenIdPlaceholder}/rss`;
  }
  return `${canonicalNoSlash}/${API_PREFIX}/public/podcasts/${slugEnc}/rss`;
}

export function generateRss(
  podcastId: string,
  publicBaseUrl?: string | null,
  options?: GenerateRssOptions,
): string {
  const opts = options ?? {};
  const includeSubscriberOnly = opts.includeSubscriberOnlyEpisodes === true;
  const tokenIdPlaceholder = opts.tokenIdPlaceholder;

  const podcast = drizzleDb
    .select()
    .from(podcasts)
    .where(eq(podcasts.id, podcastId))
    .limit(1)
    .get();
  if (!podcast) throw new Error("Podcast not found");

  // If no publicBaseUrl provided, try to get one from exports or hostname setting
  let publicBase = sanitizeHttpUrl(publicBaseUrl);
  let exportPrefix: string | null = null;
  if (!publicBase) {
    const exportWithUrl = drizzleDb
      .select()
      .from(exports)
      .where(
        and(
          eq(exports.podcastId, podcastId),
          sql`${exports.publicBaseUrl} IS NOT NULL AND LENGTH(${exports.publicBaseUrl}) > 0`,
        ),
      )
      .limit(1)
      .get();
    if (exportWithUrl?.publicBaseUrl) {
      publicBase = sanitizeHttpUrl(exportWithUrl.publicBaseUrl);
      exportPrefix = getExportPathPrefix(exportWithUrl);
    } else {
      const hostnameVal = getSetting("hostname");
      if (hostnameVal?.trim()) {
        publicBase = sanitizeHttpUrl(hostnameVal);
      }
    }
  } else {
    const exportRow = drizzleDb
      .select()
      .from(exports)
      .where(eq(exports.podcastId, podcastId))
      .limit(1)
      .get();
    if (exportRow) {
      exportPrefix = getExportPathPrefix(exportRow);
    }
  }

  // Token feed: always use app hostname for URLs (no S3); need base URL for placeholder paths
  if (tokenIdPlaceholder) {
    const hostnameVal = getSetting("hostname");
    const hostBase = hostnameVal?.trim() ? sanitizeHttpUrl(hostnameVal.trim()) : "";
    if (hostBase) publicBase = hostBase;
    exportPrefix = null; // token feed URLs are app paths only
  }

  const episodeWhere = includeSubscriberOnly
    ? and(
        eq(episodes.podcastId, podcastId),
        eq(episodes.status, "published"),
        sql`(${episodes.publishAt} IS NULL OR datetime(${episodes.publishAt}) <= datetime('now'))`,
      )
    : and(
        eq(episodes.podcastId, podcastId),
        eq(episodes.status, "published"),
        eq(episodes.subscriberOnly, false),
        sql`(${episodes.publishAt} IS NULL OR datetime(${episodes.publishAt}) <= datetime('now'))`,
      );
  const episodesList = drizzleDb
    .select()
    .from(episodes)
    .where(episodeWhere)
    .orderBy(desc(episodes.publishAt), desc(episodes.createdAt))
    .limit(300)
    .all();

  const titleRaw = String(podcast.title ?? "");
  const title = escapeCdata(titleRaw);
  const description = escapeCdata(String(podcast.description ?? ""));
  const summaryRaw =
    podcast.summary != null ? String(podcast.summary).trim() : "";
  const summary = summaryRaw ? escapeCdata(summaryRaw) : description;
  const subtitleRaw =
    podcast.subtitle != null ? String(podcast.subtitle).trim() : "";
  const subtitle = subtitleRaw ? escapeCdata(subtitleRaw) : "";
  const language = escapeXml(String(podcast.language ?? "en"));
  const author = escapeCdata(
    String(podcast.authorName ?? podcast.ownerName ?? ""),
  );
  const ownerName = escapeCdata(String(podcast.ownerName ?? ""));
  const emailRaw = String(podcast.email ?? "").trim();
  const email = escapeXml(emailRaw);
  const categoryPrimary = escapeXml(String(podcast.categoryPrimary ?? ""));
  const categorySecondary = podcast.categorySecondary
    ? escapeXml(String(podcast.categorySecondary))
    : "";
  const categoryPrimaryTwo = podcast.categoryPrimaryTwo
    ? escapeXml(String(podcast.categoryPrimaryTwo))
    : "";
  const categorySecondaryTwo = podcast.categorySecondaryTwo
    ? escapeXml(String(podcast.categorySecondaryTwo))
    : "";
  const categoryPrimaryThree = podcast.categoryPrimaryThree
    ? escapeXml(String(podcast.categoryPrimaryThree))
    : "";
  const categorySecondaryThree = podcast.categorySecondaryThree
    ? escapeXml(String(podcast.categorySecondaryThree))
    : "";
  const explicit = podcast.explicit === true ? "true" : "false";
  const siteUrl = sanitizeHttpUrl(podcast.siteUrl);
  const slugRaw = stripControlChars(String(podcast.slug ?? "")).trim();
  const copyright = podcast.copyright
    ? escapeXml(String(podcast.copyright))
    : "";
  const podcastGuid = podcast.podcastGuid
    ? escapeXml(String(podcast.podcastGuid))
    : "";
  const locked = podcast.locked ? "yes" : "no";
  const itunesType = escapeXml(
    String((podcast.itunesType as string) || "episodic"),
  );
  const medium = escapeXml(String((podcast.medium as string) || "podcast"));

  const publicBaseNoSlash = publicBase ? publicBase.replace(/\/$/, "") : "";

  // Base URL for app feed pages (channel link and episode links when site_url / episode_link not set)
  const feedBaseHostname = getSetting("hostname");
  const feedBaseUrlRaw = feedBaseHostname?.trim()
    ? sanitizeHttpUrl(feedBaseHostname.trim())
    : "";
  const feedBaseUrl = feedBaseUrlRaw ? feedBaseUrlRaw.replace(/\/+$/, "") : "";

  const websubDiscoveryEnabled = getSetting("websub_discovery_enabled") === "true";
  const websubHubVal = getSetting("websub_hub");
  const websubHubUrl =
    websubDiscoveryEnabled && websubHubVal?.trim()
      ? sanitizeHttpUrl(websubHubVal.trim())
      : "";

  const slugEnc = encodeURIComponent(slugRaw);

  let artworkUrl = "";
  // Prefer artworkUrl if set, otherwise use artworkPath if available
  if (podcast.artworkUrl) {
    artworkUrl = sanitizeHttpUrl(podcast.artworkUrl);
  } else if (podcast.artworkPath && publicBaseNoSlash) {
    if (tokenIdPlaceholder) {
      const filename = basename(podcast.artworkPath as string);
      artworkUrl = `${publicBaseNoSlash}/${API_PREFIX}/public/podcasts/${slugEnc}/private/${tokenIdPlaceholder}/artwork/${encodeURIComponent(filename)}`;
    } else if (exportPrefix != null) {
      const ext = artworkExt(podcast.artworkPath as string);
      artworkUrl = exportPrefix
        ? `${publicBaseNoSlash}/${exportPrefix}/cover.${ext}`
        : `${publicBaseNoSlash}/cover.${ext}`;
    } else {
      const filename = basename(podcast.artworkPath as string);
      artworkUrl = `${publicBaseNoSlash}/${API_PREFIX}/public/artwork/${encodeURIComponent(podcastId)}/${encodeURIComponent(filename)}`;
    }
  }

  // Build RSS feed URL (atom:link rel="self"): S3 feed URL when deployed there, else app API URL
  let rssFeedUrl = "";
  if (publicBaseNoSlash) {
    if (tokenIdPlaceholder && slugRaw) {
      rssFeedUrl = `${publicBaseNoSlash}/${API_PREFIX}/public/podcasts/${slugEnc}/private/${tokenIdPlaceholder}/rss`;
    } else if (exportPrefix != null) {
      rssFeedUrl = exportPrefix
        ? `${publicBaseNoSlash}/${exportPrefix}/${RSS_FEED_FILENAME}`
        : `${publicBaseNoSlash}/${RSS_FEED_FILENAME}`;
    } else if (slugRaw) {
      rssFeedUrl = `${publicBaseNoSlash}/${API_PREFIX}/public/podcasts/${slugEnc}/rss`;
    }
  }

  const atomSelfHref = atomLinkSelfHref({
    rssFeedUrl,
    exportPrefix,
    podcast,
    slugEnc,
    slugRaw,
    tokenIdPlaceholder,
  });

  const nowRfc2822 = new Date().toUTCString();
  const lastBuildDate =
    episodesList.length > 0
      ? episodesList[0].publishAt
        ? new Date(String(episodesList[0].publishAt)).toUTCString()
        : new Date(String(episodesList[0].updatedAt)).toUTCString()
      : nowRfc2822;

  // When no podcast site_url is set, use the public feed URL (app hostname + /feed/slug)
  const fallbackSiteUrl =
    feedBaseUrl && slugRaw
      ? `${feedBaseUrl}/feed/${encodeURIComponent(slugRaw)}`
      : "";
  const channelLink = siteUrl || fallbackSiteUrl;

  // Root-relative URL: resolved against the RSS document origin so custom domains /
  // host aliases load /style.xsl from the same site (avoid cross-origin blocking).
  const stylesheetHref = exportPrefix == null ? "/style.xsl" : "";
  // Omit xml-stylesheet when feed is for S3 deploy (style.xsl is not uploaded there)
  const stylesheetPi = stylesheetHref
    ? `<?xml-stylesheet type="text/xsl" href="${escapeXml(stylesheetHref)}"?>\n`
    : "";

  let out = `<?xml version="1.0" encoding="UTF-8"?>
${stylesheetPi}<rss xmlns:podcast="https://podcastindex.org/namespace/1.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:spotify="https://www.spotify.com/ns/rss" xmlns:psc="http://podlove.org/simple-chapters" xmlns:atom="http://www.w3.org/2005/Atom" xml:lang="${language}" version="2.0">
  <channel>
    <title><![CDATA[${title}]]></title>
`;
  if (channelLink) out += `    <link>${escapeXml(channelLink)}</link>\n`;
  if (atomSelfHref) {
    out += `    <atom:link href="${escapeXml(atomSelfHref)}" rel="self" type="application/rss+xml"/>\n`;
  }
  if (websubHubUrl) {
    out += `    <atom:link rel="hub" href="${escapeXml(websubHubUrl)}"/>\n`;
  }
  out += `    <description><![CDATA[${description}]]></description>
    <itunes:summary><![CDATA[${summary}]]></itunes:summary>
`;
  if (subtitle)
    out += `    <itunes:subtitle><![CDATA[${subtitle}]]></itunes:subtitle>\n`;
  out += `    <generator>${APP_NAME}</generator>
    <lastBuildDate>${lastBuildDate}</lastBuildDate>
    <language>${language}</language>
`;
  if (copyright)
    out += `    <copyright><![CDATA[${escapeCdata(String(podcast.copyright))}]]></copyright>\n`;
  if (artworkUrl)
    out += `    <itunes:image href="${escapeXml(artworkUrl)}"/>\n`;
  if (podcastGuid) out += `    <podcast:guid>${podcastGuid}</podcast:guid>\n`;
  if (artworkUrl) {
    out += `    <image>
      <url>${escapeXml(artworkUrl)}</url>
      <title><![CDATA[${title}]]></title>
${channelLink ? `      <link>${escapeXml(channelLink)}</link>\n` : ""}    </image>
`;
  }
  out += `    <podcast:locked>${locked}</podcast:locked>\n`;
  // Podcast 2.0 channel metadata
  {
    type ChannelMeta = {
      license?: string | null;
      fundingLinks?: string | null;
      podcastTxts?: string | null;
      socialInteracts?: string | null;
      locations?: string | null;
      chat?: string | null;
      valueBlocks?: string | null;
      blocks?: string | null;
      publisher?: string | null;
      podroll?: string | null;
      updateFrequency?: string | null;
    };
    const meta = podcast as ChannelMeta;
    const parseArr = <T extends object>(raw: string | null | undefined): T[] => {
      if (typeof raw !== "string" || !raw.trim()) return [];
      try {
        const parsed = JSON.parse(raw) as unknown;
        return Array.isArray(parsed)
          ? parsed.filter((x): x is T => typeof x === "object" && x != null)
          : [];
      } catch {
        return [];
      }
    };
    const parseObj = <T extends object>(raw: string | null | undefined): T | null => {
      if (typeof raw !== "string" || !raw.trim()) return null;
      try {
        const parsed = JSON.parse(raw) as unknown;
        return typeof parsed === "object" && parsed != null && !Array.isArray(parsed)
          ? (parsed as T)
          : null;
      } catch {
        return null;
      }
    };

    {
      let licenseObj = parseObj<{ identifier?: string; url?: string | null }>(meta.license);
      if (
        !licenseObj &&
        typeof meta.license === "string" &&
        meta.license.trim() &&
        !meta.license.trim().startsWith("{")
      ) {
        licenseObj = { identifier: meta.license.trim() };
      }
      const identifier =
        licenseObj && typeof licenseObj.identifier === "string"
          ? licenseObj.identifier.trim().slice(0, 128)
          : "";
      if (identifier) {
        const url = sanitizeHttpUrl(licenseObj?.url);
        if (url) {
          out += `    <podcast:license url="${escapeXml(url)}">${escapeXml(identifier)}</podcast:license>\n`;
        } else {
          out += `    <podcast:license>${escapeXml(identifier)}</podcast:license>\n`;
        }
      }
    }

    for (const fund of parseArr<{ url?: string; text?: string | null }>(meta.fundingLinks)) {
      const url = sanitizeHttpUrl(fund.url);
      if (!url) continue;
      const text =
        typeof fund.text === "string" && fund.text.trim()
          ? fund.text.trim().slice(0, 128)
          : "";
      if (text) {
        out += `    <podcast:funding url="${escapeXml(url)}">${escapeXml(text)}</podcast:funding>\n`;
      } else {
        out += `    <podcast:funding url="${escapeXml(url)}"/>\n`;
      }
    }

    for (const block of parseArr<{ id?: string | null; value?: string }>(meta.blocks)) {
      const value = block.value === "yes" || block.value === "no" ? block.value : "";
      if (!value) continue;
      const id = typeof block.id === "string" && block.id.trim() ? block.id.trim() : "";
      if (id) {
        out += `    <podcast:block id="${escapeXml(id)}">${value}</podcast:block>\n`;
      } else {
        out += `    <podcast:block>${value}</podcast:block>\n`;
      }
    }

    for (const txt of parseArr<{ purpose?: string | null; value?: string }>(meta.podcastTxts)) {
      const value = typeof txt.value === "string" ? txt.value.trim() : "";
      if (!value) continue;
      const purpose =
        typeof txt.purpose === "string" && txt.purpose.trim()
          ? txt.purpose.trim().slice(0, 128)
          : "";
      if (purpose) {
        out += `    <podcast:txt purpose="${escapeXml(purpose)}">${escapeXml(value.slice(0, 4000))}</podcast:txt>\n`;
      } else {
        out += `    <podcast:txt>${escapeXml(value.slice(0, 4000))}</podcast:txt>\n`;
      }
    }

    for (const si of parseArr<{
      protocol?: string;
      uri?: string | null;
      accountId?: string | null;
      accountUrl?: string | null;
      priority?: number | null;
    }>(meta.socialInteracts)) {
      const protocol = typeof si.protocol === "string" ? si.protocol.trim() : "";
      if (!protocol) continue;
      if (protocol.toLowerCase() === "disabled") {
        out += `    <podcast:socialInteract protocol="disabled"/>\n`;
        continue;
      }
      const uri = sanitizeHttpUrl(si.uri);
      if (!uri) continue;
      let attrs = `protocol="${escapeXml(protocol)}" uri="${escapeXml(uri)}"`;
      if (typeof si.accountId === "string" && si.accountId.trim()) {
        attrs += ` accountId="${escapeXml(si.accountId.trim())}"`;
      }
      const accountUrl = sanitizeHttpUrl(si.accountUrl);
      if (accountUrl) attrs += ` accountUrl="${escapeXml(accountUrl)}"`;
      if (typeof si.priority === "number" && Number.isFinite(si.priority) && si.priority >= 0) {
        attrs += ` priority="${Math.floor(si.priority)}"`;
      }
      out += `    <podcast:socialInteract ${attrs}/>\n`;
    }

    for (const loc of parseArr<{
      name?: string;
      rel?: string | null;
      geo?: string | null;
      osm?: string | null;
      country?: string | null;
    }>(meta.locations)) {
      const name = typeof loc.name === "string" ? loc.name.trim().slice(0, 128) : "";
      if (!name) continue;
      let attrs = "";
      if (loc.rel === "subject" || loc.rel === "creator") attrs += ` rel="${loc.rel}"`;
      if (typeof loc.geo === "string" && loc.geo.trim()) {
        attrs += ` geo="${escapeXml(loc.geo.trim())}"`;
      }
      if (typeof loc.osm === "string" && loc.osm.trim()) {
        attrs += ` osm="${escapeXml(loc.osm.trim())}"`;
      }
      if (typeof loc.country === "string" && /^[A-Za-z]{2}$/.test(loc.country.trim())) {
        attrs += ` country="${escapeXml(loc.country.trim().toUpperCase())}"`;
      }
      out += `    <podcast:location${attrs}>${escapeXml(name)}</podcast:location>\n`;
    }

    {
      const chat = parseObj<{
        server?: string;
        protocol?: string;
        accountId?: string | null;
        space?: string | null;
      }>(meta.chat);
      const server = chat && typeof chat.server === "string" ? chat.server.trim() : "";
      const protocol = chat && typeof chat.protocol === "string" ? chat.protocol.trim() : "";
      if (server && protocol) {
        let attrs = `server="${escapeXml(server)}" protocol="${escapeXml(protocol)}"`;
        if (typeof chat?.accountId === "string" && chat.accountId.trim()) {
          attrs += ` accountId="${escapeXml(chat.accountId.trim())}"`;
        }
        if (typeof chat?.space === "string" && chat.space.trim()) {
          attrs += ` space="${escapeXml(chat.space.trim())}"`;
        }
        out += `    <podcast:chat ${attrs}/>\n`;
      }
    }

    {
      const pub = parseObj<{
        feedGuid?: string;
        feedUrl?: string | null;
        medium?: string | null;
      }>(meta.publisher);
      const feedGuid = pub && typeof pub.feedGuid === "string" ? pub.feedGuid.trim() : "";
      if (feedGuid) {
        const med =
          pub && typeof pub.medium === "string" && pub.medium.trim()
            ? pub.medium.trim()
            : "publisher";
        let attrs = `medium="${escapeXml(med)}" feedGuid="${escapeXml(feedGuid)}"`;
        const feedUrl = sanitizeHttpUrl(pub?.feedUrl);
        if (feedUrl) attrs += ` feedUrl="${escapeXml(feedUrl)}"`;
        out += `    <podcast:publisher>\n      <podcast:remoteItem ${attrs}/>\n    </podcast:publisher>\n`;
      }
    }

    {
      const rollItems = parseArr<{
        feedGuid?: string;
        feedUrl?: string | null;
        title?: string | null;
      }>(meta.podroll).filter(
        (item) => typeof item.feedGuid === "string" && item.feedGuid.trim(),
      );
      if (rollItems.length > 0) {
        out += `    <podcast:podroll>\n`;
        for (const item of rollItems) {
          const feedGuid = String(item.feedGuid).trim();
          let attrs = `feedGuid="${escapeXml(feedGuid)}"`;
          const feedUrl = sanitizeHttpUrl(item.feedUrl);
          if (feedUrl) attrs += ` feedUrl="${escapeXml(feedUrl)}"`;
          const title =
            typeof item.title === "string" ? item.title.trim() : "";
          if (title) attrs += ` title="${escapeXml(title.slice(0, 256))}"`;
          out += `      <podcast:remoteItem ${attrs}/>\n`;
        }
        out += `    </podcast:podroll>\n`;
      }
    }

    for (const block of parseArr<{
      type?: string;
      method?: string;
      suggested?: string | null;
      recipients?: Array<{
        type?: string;
        address?: string;
        split?: number;
        name?: string | null;
        customKey?: string | null;
        customValue?: string | null;
        fee?: boolean | null;
      }>;
    }>(meta.valueBlocks)) {
      const type = typeof block.type === "string" ? block.type.trim() : "";
      const method = typeof block.method === "string" ? block.method.trim() : "";
      if (!type || !method) continue;
      const recipients = Array.isArray(block.recipients) ? block.recipients : [];
      const validRecipients = recipients.filter(
        (r) =>
          typeof r?.type === "string" &&
          r.type.trim() &&
          typeof r?.address === "string" &&
          r.address.trim() &&
          typeof r?.split === "number" &&
          Number.isFinite(r.split) &&
          r.split >= 0,
      );
      if (validRecipients.length === 0) continue;
      let attrs = `type="${escapeXml(type)}" method="${escapeXml(method)}"`;
      if (typeof block.suggested === "string" && block.suggested.trim()) {
        attrs += ` suggested="${escapeXml(block.suggested.trim())}"`;
      }
      out += `    <podcast:value ${attrs}>\n`;
      for (const r of validRecipients) {
        let rAttrs = `type="${escapeXml(r.type!.trim())}" address="${escapeXml(r.address!.trim())}" split="${Math.floor(r.split!)}"`;
        if (typeof r.name === "string" && r.name.trim()) {
          rAttrs += ` name="${escapeXml(r.name.trim())}"`;
        }
        if (typeof r.customKey === "string" && r.customKey.trim()) {
          rAttrs += ` customKey="${escapeXml(r.customKey.trim())}"`;
        }
        if (typeof r.customValue === "string" && r.customValue.trim()) {
          rAttrs += ` customValue="${escapeXml(r.customValue.trim())}"`;
        }
        if (r.fee === true) rAttrs += ` fee="true"`;
        out += `      <podcast:valueRecipient ${rAttrs}/>\n`;
      }
      out += `    </podcast:value>\n`;
    }

    {
      const uf = parseObj<{
        rrule?: string | null;
        label?: string | null;
        complete?: boolean | null;
        dtstart?: string | null;
      }>(meta.updateFrequency);
      if (uf) {
        const rrule = typeof uf.rrule === "string" ? uf.rrule.trim() : "";
        const label =
          typeof uf.label === "string" && uf.label.trim()
            ? uf.label.trim().slice(0, 128)
            : "";
        const dtstart = typeof uf.dtstart === "string" ? uf.dtstart.trim() : "";
        const complete = uf.complete === true;
        if (complete || rrule || dtstart || label) {
          let attrs = "";
          if (complete) attrs += ` complete="true"`;
          if (dtstart) attrs += ` dtstart="${escapeXml(dtstart)}"`;
          if (rrule) attrs += ` rrule="${escapeXml(rrule)}"`;
          if (label) {
            out += `    <podcast:updateFrequency${attrs}>${escapeXml(label)}</podcast:updateFrequency>\n`;
          } else {
            out += `    <podcast:updateFrequency${attrs}/>\n`;
          }
        }
      }
    }
  }
  // Podcast 2.0 <podcast:person> for channel: public show-cast hosts when present.
  // Spec: https://podcasting2.org/docs/podcast-namespace/tags/person
  // (role defaults to host; group defaults to cast; we set role explicitly.)
  {
    const hosts = drizzleDb
      .select({
        id: podcastCast.id,
        name: podcastCast.name,
        photoPath: podcastCast.photoPath,
        photoUrl: podcastCast.photoUrl,
        socialLinkText: podcastCast.socialLinkText,
      })
      .from(podcastCast)
      .where(
        and(
          eq(podcastCast.podcastId, podcastId),
          eq(podcastCast.role, "host"),
          eq(podcastCast.isPublic, true),
        ),
      )
      .orderBy(asc(podcastCast.createdAt))
      .all();

    if (hosts.length > 0) {
      for (const host of hosts) {
        const name = String(host.name ?? "").trim().slice(0, 128);
        if (!name) continue;

        let img = "";
        if (host.photoPath && publicBaseNoSlash) {
          try {
            const resolved = resolveDataPath(host.photoPath);
            assertPathUnder(resolved, castPhotoDir(podcastId));
            const filename = basename(host.photoPath);
            img = `${publicBaseNoSlash}/${API_PREFIX}/public/artwork/${encodeURIComponent(podcastId)}/cast/${encodeURIComponent(host.id)}/${encodeURIComponent(filename)}`;
          } catch {
            img = "";
          }
        }
        if (!img && host.photoUrl) {
          img = sanitizeHttpUrl(host.photoUrl);
        }

        const href = host.socialLinkText
          ? sanitizeHttpUrl(host.socialLinkText)
          : "";

        let attrs = `role="host"`;
        if (href) attrs += ` href="${escapeXml(href)}"`;
        if (img) attrs += ` img="${escapeXml(img)}"`;
        out += `    <podcast:person ${attrs}>${escapeXml(name)}</podcast:person>\n`;
      }
    } else {
      // Fallback: legacy free-form persons list from show More tab
      const personsJson = podcast.persons;
      if (personsJson && typeof personsJson === "string") {
        try {
          const arr = JSON.parse(personsJson) as unknown[];
          if (Array.isArray(arr)) {
            for (const p of arr) {
              if (typeof p === "string" && p.trim()) {
                const name = p.trim().slice(0, 128);
                out += `    <podcast:person role="host">${escapeXml(name)}</podcast:person>\n`;
              }
            }
          }
        } catch {
          // ignore invalid JSON
        }
      }
    }
  }
  const spotifyCount = podcast.spotifyRecentCount;
  const spotifyCountNum =
    typeof spotifyCount === "number" ? spotifyCount : Number(spotifyCount);
  if (
    spotifyCount != null &&
    Number.isInteger(spotifyCountNum) &&
    spotifyCountNum >= 0
  ) {
    out += `    <spotify:limit recentCount="${spotifyCountNum}"/>\n`;
  }
  const spotifyCountry =
    podcast.spotifyCountryOfOrigin != null
      ? String(podcast.spotifyCountryOfOrigin).trim()
      : "";
  if (spotifyCountry)
    out += `    <spotify:countryOfOrigin>${escapeXml(spotifyCountry)}</spotify:countryOfOrigin>\n`;
  const appleVerify =
    podcast.applePodcastsVerify != null
      ? String(podcast.applePodcastsVerify).trim()
      : "";
  if (appleVerify)
    out += `    <itunes:applepodcastsverify>${escapeXml(appleVerify)}</itunes:applepodcastsverify>\n`;
  out += `    <itunes:author><![CDATA[${author}]]></itunes:author>
    <itunes:owner>
      <itunes:name><![CDATA[${ownerName}]]></itunes:name>
${emailRaw ? `      <itunes:email>${email}</itunes:email>\n` : ""}    </itunes:owner>
    <itunes:explicit>${explicit}</itunes:explicit>
    <itunes:type>${itunesType}</itunes:type>
`;

  // Categories - up to 3 pairs (primary+secondary each). Secondary only when primary set.
  if (categoryPrimary && categorySecondary) {
    out += `    <itunes:category text="${categoryPrimary}">
      <itunes:category text="${categorySecondary}"/>
    </itunes:category>
`;
  } else if (categoryPrimary) {
    out += `    <itunes:category text="${categoryPrimary}"/>\n`;
  }
  if (categoryPrimaryTwo && categorySecondaryTwo) {
    out += `    <itunes:category text="${categoryPrimaryTwo}">
      <itunes:category text="${categorySecondaryTwo}"/>
    </itunes:category>
`;
  } else if (categoryPrimaryTwo) {
    out += `    <itunes:category text="${categoryPrimaryTwo}"/>\n`;
  }
  if (categoryPrimaryThree && categorySecondaryThree) {
    out += `    <itunes:category text="${categoryPrimaryThree}">
      <itunes:category text="${categorySecondaryThree}"/>
    </itunes:category>
`;
  } else if (categoryPrimaryThree) {
    out += `    <itunes:category text="${categoryPrimaryThree}"/>\n`;
  }

  out += `    <podcast:medium>${medium}</podcast:medium>
`;

  // Podcast 2.0 channel trailers: every in-feed episode marked episodeType=trailer.
  const enclosureOpts = {
    publicBaseNoSlash,
    podcastId,
    slugEnc,
    slugRaw,
    tokenIdPlaceholder,
    exportPrefix,
  };
  for (const ep of episodesList) {
    const epType = String(ep.episodeType ?? "").toLowerCase();
    if (epType !== "trailer") continue;
    if (!ep.audioFinalPath) continue;
    const trailerUrl = episodeEnclosureUrl(ep, enclosureOpts);
    if (!trailerUrl) continue;
    const trailerTitleRaw = String(ep.title ?? "").trim() || "Trailer";
    const trailerTitle = escapeXml(
      trailerTitleRaw.length > 128 ? trailerTitleRaw.slice(0, 128) : trailerTitleRaw,
    );
    const trailerPubDate = ep.publishAt
      ? new Date(String(ep.publishAt)).toUTCString()
      : new Date(String(ep.updatedAt ?? Date.now())).toUTCString();
    const trailerBytes = ep.audioBytes != null ? Number(ep.audioBytes) : 0;
    const trailerMime =
      typeof ep.audioMime === "string" && ep.audioMime.trim()
        ? ep.audioMime.trim()
        : "audio/mpeg";
    const seasonNum = ep.seasonNumber != null ? Number(ep.seasonNumber) : null;
    const seasonAttr =
      seasonNum != null && Number.isFinite(seasonNum) && seasonNum > 0
        ? ` season="${seasonNum}"`
        : "";
    out += `    <podcast:trailer pubdate="${escapeXml(trailerPubDate)}" url="${escapeXml(trailerUrl)}" length="${trailerBytes}" type="${escapeXml(trailerMime)}"${seasonAttr}>${trailerTitle}</podcast:trailer>\n`;
  }

  for (const ep of episodesList) {
    const epTitle = escapeCdata(String(ep.title ?? ""));
    const baseDesc = String(ep.description ?? "");
    const snapshot =
      ep.descriptionCopyrightSnapshot != null
        ? String(ep.descriptionCopyrightSnapshot).trim()
        : "";
    const epDesc = escapeCdata(
      snapshot ? `${baseDesc}\r\n\r\nMusic:\r\n${snapshot}` : baseDesc,
    );
    const epSummaryRaw = ep.summary != null ? String(ep.summary).trim() : "";
    const epSummary = epSummaryRaw ? escapeCdata(epSummaryRaw) : "";
    const epSubtitleRaw = ep.subtitle != null ? String(ep.subtitle).trim() : "";
    const epSubtitle = epSubtitleRaw ? escapeCdata(epSubtitleRaw) : "";
    const epContentEncoded =
      ep.contentEncoded != null ? String(ep.contentEncoded).trim() : "";
    const guid = escapeXml(String(ep.guid ?? ep.id));
    const pubDate = ep.publishAt
      ? new Date(String(ep.publishAt)).toUTCString()
      : new Date(String(ep.updatedAt)).toUTCString();
    const epExplicit =
      ep.explicit === true || (ep.explicit == null && podcast.explicit === true)
        ? "true"
        : "false";
    const duration =
      ep.audioDurationSec != null ? Number(ep.audioDurationSec) : 0;
    const season = ep.seasonNumber != null ? Number(ep.seasonNumber) : null;
    const episodeNum =
      ep.episodeNumber != null ? Number(ep.episodeNumber) : null;
    const episodeType = (ep.episodeType as string) || "full";

    const enclosureUrl = episodeEnclosureUrl(ep, {
      publicBaseNoSlash,
      podcastId,
      slugEnc,
      slugRaw,
      tokenIdPlaceholder,
      exportPrefix,
    });

    const epLink = sanitizeHttpUrl(ep.episodeLink);
    const epSlugRaw =
      ep.slug != null ? stripControlChars(String(ep.slug)).trim() : "";
    const fallbackEpLink =
      feedBaseUrl && slugRaw && epSlugRaw
        ? `${feedBaseUrl}/feed/${encodeURIComponent(slugRaw)}/${encodeURIComponent(epSlugRaw)}`
        : channelLink;
    const itemLink = epLink || fallbackEpLink;
    const guidIsPermaLink = ep.guidIsPermalink === true;

    out += `    <item>
      <title><![CDATA[${epTitle}]]></title>
      <itunes:title><![CDATA[${epTitle}]]></itunes:title>
      <description><![CDATA[${epDesc}]]></description>
`;
    if (epSummary)
      out += `      <itunes:summary><![CDATA[${epSummary}]]></itunes:summary>\n`;
    if (epSubtitle)
      out += `      <itunes:subtitle><![CDATA[${epSubtitle}]]></itunes:subtitle>\n`;
    if (epContentEncoded)
      out += `      <content:encoded><![CDATA[${epContentEncoded.replace(/\]\]>/g, "]]]]><![CDATA[>")}]]></content:encoded>\n`;
    if (itemLink) out += `      <link>${escapeXml(itemLink)}</link>\n`;
    if (enclosureUrl) {
      const bytes = ep.audioBytes != null ? Number(ep.audioBytes) : 0;
      const enclosureType =
        typeof ep.audioMime === "string" && ep.audioMime
          ? ep.audioMime
          : "audio/mpeg";
      out += `      <enclosure url="${escapeXml(enclosureUrl)}" length="${bytes}" type="${escapeXml(enclosureType)}"/>\n`;
    }
    let videoUrl = "";
    if (ep.videoFinalPath && publicBaseNoSlash && ep.id) {
      const validEpisodeId = String(ep.id).trim();
      if (validEpisodeId) {
        if (tokenIdPlaceholder && slugRaw) {
          videoUrl = `${publicBaseNoSlash}/${API_PREFIX}/public/podcasts/${slugEnc}/private/${tokenIdPlaceholder}/episodes/${encodeURIComponent(validEpisodeId)}/video`;
        } else if (exportPrefix == null && podcastId) {
          const validPodcastId = String(podcastId).trim();
          if (validPodcastId) {
            videoUrl = `${publicBaseNoSlash}/${API_PREFIX}/${encodeURIComponent(validPodcastId)}/episodes/${encodeURIComponent(validEpisodeId)}/video`;
          }
        }
      }
    }
    let videoBytes = 0;
    if (videoUrl && ep.videoFinalPath && typeof ep.videoFinalPath === "string") {
      try {
        const resolved = resolveDataPath(ep.videoFinalPath);
        const allowedBase = processedDir(podcastId, String(ep.id));
        if (existsSync(resolved)) {
          assertPathUnder(resolved, allowedBase);
          videoBytes = statSync(resolved).size;
        }
      } catch {
        videoBytes = 0;
      }
    }
    if (videoUrl) {
      out += `      <podcast:alternateEnclosure type="video/mp4" length="${videoBytes}">
        <podcast:source uri="${escapeXml(videoUrl)}"/>
      </podcast:alternateEnclosure>\n`;
    }
    out += `      <guid isPermaLink="${guidIsPermaLink}">${guid}</guid>
`;
    if (duration > 0)
      out += `      <itunes:duration>${duration}</itunes:duration>\n`;
    out += `      <itunes:episodeType>${escapeXml(episodeType)}</itunes:episodeType>\n`;
    if (season != null) {
      out += `      <itunes:season>${season}</itunes:season>\n`;
      out += `      <podcast:season>${season}</podcast:season>\n`;
    }
    if (episodeNum != null) {
      out += `      <itunes:episode>${episodeNum}</itunes:episode>\n`;
      out += `      <podcast:episode>${episodeNum}</podcast:episode>\n`;
    }
    let epArtworkUrl = "";
    if (ep.artworkUrl) {
      epArtworkUrl = sanitizeHttpUrl(ep.artworkUrl);
    } else if (ep.artworkPath && publicBaseNoSlash && ep.id) {
      if (tokenIdPlaceholder && slugRaw) {
        const filename = basename(String(ep.artworkPath));
        epArtworkUrl = `${publicBaseNoSlash}/${API_PREFIX}/public/podcasts/${slugEnc}/private/${tokenIdPlaceholder}/artwork/episodes/${encodeURIComponent(String(ep.id))}/${encodeURIComponent(filename)}`;
      } else if (exportPrefix != null) {
        const ext = artworkExt(ep.artworkPath as string);
        epArtworkUrl = `${publicBaseNoSlash}/${exportPrefix}/episodes/${String(ep.id)}.${ext}`;
      } else if (podcastId) {
        const filename = basename(String(ep.artworkPath));
        epArtworkUrl = `${publicBaseNoSlash}/${API_PREFIX}/public/artwork/${encodeURIComponent(podcastId)}/episodes/${encodeURIComponent(String(ep.id))}/${encodeURIComponent(filename)}`;
      }
    }
    if (epArtworkUrl)
      out += `      <itunes:image href="${escapeXml(epArtworkUrl)}"/>\n`;
    const episodeTranscriptPath = join(
      getDataDir(),
      "processed",
      podcastId,
      String(ep.id),
      "transcript.srt",
    );
    if (existsSync(episodeTranscriptPath) && publicBaseNoSlash && epSlugRaw) {
      let transcriptUrl = "";
      if (tokenIdPlaceholder && slugRaw) {
        transcriptUrl = `${publicBaseNoSlash}/${API_PREFIX}/public/podcasts/${slugEnc}/private/${tokenIdPlaceholder}/episodes/${encodeURIComponent(epSlugRaw)}/transcript.srt`;
      } else if (exportPrefix != null) {
        transcriptUrl = `${publicBaseNoSlash}/${exportPrefix}/episodes/${String(ep.id)}.srt`;
      } else {
        transcriptUrl = `${publicBaseNoSlash}/${API_PREFIX}/public/podcasts/${slugEnc}/episodes/${encodeURIComponent(epSlugRaw)}/transcript.srt`;
      }
      if (transcriptUrl)
        out += `      <podcast:transcript url="${escapeXml(transcriptUrl)}" type="application/srt"/>\n`;
    }
    const episodeChaptersPath = chaptersJsonPath(podcastId, String(ep.id));
    if (existsSync(episodeChaptersPath) && publicBaseNoSlash && epSlugRaw) {
      let chaptersUrl = "";
      if (tokenIdPlaceholder && slugRaw) {
        chaptersUrl = `${publicBaseNoSlash}/${API_PREFIX}/public/podcasts/${slugEnc}/private/${tokenIdPlaceholder}/episodes/${encodeURIComponent(epSlugRaw)}/chapters.json`;
      } else if (exportPrefix != null) {
        chaptersUrl = `${publicBaseNoSlash}/${exportPrefix}/episodes/${String(ep.id)}.json`;
      } else {
        chaptersUrl = `${publicBaseNoSlash}/${API_PREFIX}/public/podcasts/${slugEnc}/episodes/${encodeURIComponent(epSlugRaw)}/chapters.json`;
      }
      if (chaptersUrl)
        out += `      <podcast:chapters url="${escapeXml(chaptersUrl)}" type="application/json+chapters"/>\n`;
    }
    // Soundbites: same visibility gate as chapters (public base + episode slug), without requiring chapters.json
    if (publicBaseNoSlash && epSlugRaw) {
      const rawSoundbites = (ep as { finalSoundbites?: string | null }).finalSoundbites;
      let soundbites: Array<{
        time?: number;
        duration?: number;
        title?: string;
      }> = [];
      if (typeof rawSoundbites === "string" && rawSoundbites.trim()) {
        try {
          const parsed = JSON.parse(rawSoundbites) as unknown;
          if (Array.isArray(parsed)) {
            soundbites = parsed.filter(
              (s): s is { time?: number; duration?: number; title?: string } =>
                typeof s === "object" && s != null,
            );
          }
        } catch {
          /* ignore */
        }
      }
      for (const sb of soundbites) {
        const startTime = typeof sb.time === "number" && Number.isFinite(sb.time) ? sb.time : null;
        if (startTime == null || startTime < 0) continue;
        let duration =
          typeof sb.duration === "number" && Number.isFinite(sb.duration) ? sb.duration : 30;
        if (duration < 15) duration = 15;
        if (duration > 120) duration = 120;
        const titleRaw = typeof sb.title === "string" ? sb.title.trim() : "";
        const title =
          titleRaw.length > 127 ? titleRaw.slice(0, 127) : titleRaw;
        const startAttr = Number.isInteger(startTime)
          ? String(startTime)
          : startTime.toFixed(1);
        const durationAttr = Number.isInteger(duration)
          ? String(duration)
          : duration.toFixed(1);
        if (title) {
          out += `      <podcast:soundbite startTime="${escapeXml(startAttr)}" duration="${escapeXml(durationAttr)}">${escapeXml(title)}</podcast:soundbite>\n`;
        } else {
          out += `      <podcast:soundbite startTime="${escapeXml(startAttr)}" duration="${escapeXml(durationAttr)}"/>\n`;
        }
      }
    }
    // Podcast 2.0 content links (alternate platforms)
    {
      const rawContentLinks = (ep as { contentLinks?: string | null }).contentLinks;
      let contentLinks: Array<{ href?: string; text?: string | null }> = [];
      if (typeof rawContentLinks === "string" && rawContentLinks.trim()) {
        try {
          const parsed = JSON.parse(rawContentLinks) as unknown;
          if (Array.isArray(parsed)) {
            contentLinks = parsed.filter(
              (l): l is { href?: string; text?: string | null } =>
                typeof l === "object" && l != null,
            );
          }
        } catch {
          /* ignore */
        }
      }
      for (const link of contentLinks) {
        const href = sanitizeHttpUrl(link.href);
        if (!href) continue;
        const textRaw = typeof link.text === "string" ? link.text.trim() : "";
        const text = textRaw || href;
        out += `      <podcast:contentLink href="${escapeXml(href)}">${escapeXml(text)}</podcast:contentLink>\n`;
      }
    }
    // Podcast 2.0 More-tab metadata (txt, socialInteract, location, license, image, funding, chat, value)
    {
      type EpMeta = {
        podcastTxts?: string | null;
        socialInteracts?: string | null;
        locations?: string | null;
        license?: string | null;
        podcastImages?: string | null;
        fundingLinks?: string | null;
        chat?: string | null;
        valueBlocks?: string | null;
      };
      const meta = ep as EpMeta;
      const parseArr = <T extends object>(raw: string | null | undefined): T[] => {
        if (typeof raw !== "string" || !raw.trim()) return [];
        try {
          const parsed = JSON.parse(raw) as unknown;
          return Array.isArray(parsed)
            ? parsed.filter((x): x is T => typeof x === "object" && x != null)
            : [];
        } catch {
          return [];
        }
      };
      const parseObj = <T extends object>(raw: string | null | undefined): T | null => {
        if (typeof raw !== "string" || !raw.trim()) return null;
        try {
          const parsed = JSON.parse(raw) as unknown;
          return typeof parsed === "object" && parsed != null && !Array.isArray(parsed)
            ? (parsed as T)
            : null;
        } catch {
          return null;
        }
      };

      for (const txt of parseArr<{ purpose?: string | null; value?: string }>(meta.podcastTxts)) {
        const value = typeof txt.value === "string" ? txt.value.trim() : "";
        if (!value) continue;
        const purpose =
          typeof txt.purpose === "string" && txt.purpose.trim()
            ? txt.purpose.trim().slice(0, 128)
            : "";
        if (purpose) {
          out += `      <podcast:txt purpose="${escapeXml(purpose)}">${escapeXml(value.slice(0, 4000))}</podcast:txt>\n`;
        } else {
          out += `      <podcast:txt>${escapeXml(value.slice(0, 4000))}</podcast:txt>\n`;
        }
      }

      for (const si of parseArr<{
        protocol?: string;
        uri?: string | null;
        accountId?: string | null;
        accountUrl?: string | null;
        priority?: number | null;
      }>(meta.socialInteracts)) {
        const protocol = typeof si.protocol === "string" ? si.protocol.trim() : "";
        if (!protocol) continue;
        if (protocol.toLowerCase() === "disabled") {
          out += `      <podcast:socialInteract protocol="disabled"/>\n`;
          continue;
        }
        const uri = sanitizeHttpUrl(si.uri);
        if (!uri) continue;
        let attrs = `protocol="${escapeXml(protocol)}" uri="${escapeXml(uri)}"`;
        if (typeof si.accountId === "string" && si.accountId.trim()) {
          attrs += ` accountId="${escapeXml(si.accountId.trim())}"`;
        }
        const accountUrl = sanitizeHttpUrl(si.accountUrl);
        if (accountUrl) attrs += ` accountUrl="${escapeXml(accountUrl)}"`;
        if (
          typeof si.priority === "number" &&
          Number.isFinite(si.priority) &&
          si.priority >= 0
        ) {
          attrs += ` priority="${Math.floor(si.priority)}"`;
        }
        out += `      <podcast:socialInteract ${attrs}/>\n`;
      }

      for (const loc of parseArr<{
        name?: string;
        rel?: string | null;
        geo?: string | null;
        osm?: string | null;
        country?: string | null;
      }>(meta.locations)) {
        const name = typeof loc.name === "string" ? loc.name.trim().slice(0, 128) : "";
        if (!name) continue;
        let attrs = "";
        if (loc.rel === "subject" || loc.rel === "creator") {
          attrs += ` rel="${loc.rel}"`;
        }
        if (typeof loc.geo === "string" && loc.geo.trim()) {
          attrs += ` geo="${escapeXml(loc.geo.trim())}"`;
        }
        if (typeof loc.osm === "string" && loc.osm.trim()) {
          attrs += ` osm="${escapeXml(loc.osm.trim())}"`;
        }
        if (typeof loc.country === "string" && /^[A-Za-z]{2}$/.test(loc.country.trim())) {
          attrs += ` country="${escapeXml(loc.country.trim().toUpperCase())}"`;
        }
        out += `      <podcast:location${attrs}>${escapeXml(name)}</podcast:location>\n`;
      }

      {
        const license = parseObj<{ identifier?: string; url?: string | null }>(meta.license);
        const identifier =
          license && typeof license.identifier === "string"
            ? license.identifier.trim().slice(0, 128)
            : "";
        if (identifier) {
          const url = sanitizeHttpUrl(license?.url);
          if (url) {
            out += `      <podcast:license url="${escapeXml(url)}">${escapeXml(identifier)}</podcast:license>\n`;
          } else {
            out += `      <podcast:license>${escapeXml(identifier)}</podcast:license>\n`;
          }
        }
      }

      for (const img of parseArr<{
        href?: string;
        alt?: string | null;
        aspectRatio?: string | null;
        width?: number | null;
        height?: number | null;
        type?: string | null;
        purpose?: string | null;
      }>(meta.podcastImages)) {
        const href = sanitizeHttpUrl(img.href);
        if (!href) continue;
        let attrs = `href="${escapeXml(href)}"`;
        if (typeof img.alt === "string" && img.alt.trim()) {
          attrs += ` alt="${escapeXml(img.alt.trim())}"`;
        }
        if (typeof img.aspectRatio === "string" && img.aspectRatio.trim()) {
          attrs += ` aspect-ratio="${escapeXml(img.aspectRatio.trim())}"`;
        }
        if (typeof img.width === "number" && Number.isFinite(img.width) && img.width > 0) {
          attrs += ` width="${Math.floor(img.width)}"`;
        }
        if (typeof img.height === "number" && Number.isFinite(img.height) && img.height > 0) {
          attrs += ` height="${Math.floor(img.height)}"`;
        }
        if (typeof img.type === "string" && img.type.trim()) {
          attrs += ` type="${escapeXml(img.type.trim())}"`;
        }
        if (typeof img.purpose === "string" && img.purpose.trim()) {
          attrs += ` purpose="${escapeXml(img.purpose.trim().slice(0, 128))}"`;
        }
        out += `      <podcast:image ${attrs}/>\n`;
      }

      for (const fund of parseArr<{ url?: string; text?: string | null }>(meta.fundingLinks)) {
        const url = sanitizeHttpUrl(fund.url);
        if (!url) continue;
        const text =
          typeof fund.text === "string" && fund.text.trim()
            ? fund.text.trim().slice(0, 128)
            : "";
        if (text) {
          out += `      <podcast:funding url="${escapeXml(url)}">${escapeXml(text)}</podcast:funding>\n`;
        } else {
          out += `      <podcast:funding url="${escapeXml(url)}"/>\n`;
        }
      }

      {
        const chat = parseObj<{
          server?: string;
          protocol?: string;
          accountId?: string | null;
          space?: string | null;
        }>(meta.chat);
        const server = chat && typeof chat.server === "string" ? chat.server.trim() : "";
        const protocol =
          chat && typeof chat.protocol === "string" ? chat.protocol.trim() : "";
        if (server && protocol) {
          let attrs = `server="${escapeXml(server)}" protocol="${escapeXml(protocol)}"`;
          if (typeof chat?.accountId === "string" && chat.accountId.trim()) {
            attrs += ` accountId="${escapeXml(chat.accountId.trim())}"`;
          }
          if (typeof chat?.space === "string" && chat.space.trim()) {
            attrs += ` space="${escapeXml(chat.space.trim())}"`;
          }
          out += `      <podcast:chat ${attrs}/>\n`;
        }
      }

      for (const block of parseArr<{
        type?: string;
        method?: string;
        suggested?: string | null;
        recipients?: Array<{
          type?: string;
          address?: string;
          split?: number;
          name?: string | null;
          customKey?: string | null;
          customValue?: string | null;
          fee?: boolean | null;
        }>;
      }>(meta.valueBlocks)) {
        const type = typeof block.type === "string" ? block.type.trim() : "";
        const method = typeof block.method === "string" ? block.method.trim() : "";
        if (!type || !method) continue;
        const recipients = Array.isArray(block.recipients) ? block.recipients : [];
        const validRecipients = recipients.filter(
          (r) =>
            typeof r?.type === "string" &&
            r.type.trim() &&
            typeof r?.address === "string" &&
            r.address.trim() &&
            typeof r?.split === "number" &&
            Number.isFinite(r.split) &&
            r.split >= 0,
        );
        if (validRecipients.length === 0) continue;
        let attrs = `type="${escapeXml(type)}" method="${escapeXml(method)}"`;
        if (typeof block.suggested === "string" && block.suggested.trim()) {
          attrs += ` suggested="${escapeXml(block.suggested.trim())}"`;
        }
        out += `      <podcast:value ${attrs}>\n`;
        for (const r of validRecipients) {
          let rAttrs = `type="${escapeXml(r.type!.trim())}" address="${escapeXml(r.address!.trim())}" split="${Math.floor(r.split!)}"`;
          if (typeof r.name === "string" && r.name.trim()) {
            rAttrs += ` name="${escapeXml(r.name.trim())}"`;
          }
          if (typeof r.customKey === "string" && r.customKey.trim()) {
            rAttrs += ` customKey="${escapeXml(r.customKey.trim())}"`;
          }
          if (typeof r.customValue === "string" && r.customValue.trim()) {
            rAttrs += ` customValue="${escapeXml(r.customValue.trim())}"`;
          }
          if (r.fee === true) rAttrs += ` fee="true"`;
          out += `        <podcast:valueRecipient ${rAttrs}/>\n`;
        }
        out += `      </podcast:value>\n`;
      }
    }
    out += `      <itunes:explicit>${epExplicit}</itunes:explicit>
      <pubDate>${pubDate}</pubDate>
    </item>
`;
  }

  out += `  </channel>
</rss>`;
  return out;
}

/**
 * Return the public feed URL (rel="self") for a podcast, using the same base URL logic as generateRss.
 * Used e.g. for WebSub hub publish notifications (hub.url).
 */
export function getPublicFeedSelfUrl(
  podcastId: string,
  publicBaseUrl?: string | null,
): string | null {
  const podcast = drizzleDb
    .select({
      slug: podcasts.slug,
      linkDomain: podcasts.linkDomain,
      managedDomain: podcasts.managedDomain,
      managedSubDomain: podcasts.managedSubDomain,
    })
    .from(podcasts)
    .where(eq(podcasts.id, podcastId))
    .limit(1)
    .get();
  if (!podcast?.slug) return null;
  let publicBase = sanitizeHttpUrl(publicBaseUrl);
  let exportPrefix: string | null = null;
  if (!publicBase) {
    const exportWithUrl = drizzleDb
      .select()
      .from(exports)
      .where(
        and(
          eq(exports.podcastId, podcastId),
          sql`${exports.publicBaseUrl} IS NOT NULL AND LENGTH(${exports.publicBaseUrl}) > 0`,
        ),
      )
      .limit(1)
      .get();
    if (exportWithUrl?.publicBaseUrl) {
      publicBase = sanitizeHttpUrl(exportWithUrl.publicBaseUrl);
      exportPrefix = getExportPathPrefix(exportWithUrl);
    } else {
      const hostnameVal = getSetting("hostname");
      if (hostnameVal?.trim()) publicBase = sanitizeHttpUrl(hostnameVal);
    }
  } else {
    const exportRow = drizzleDb
      .select()
      .from(exports)
      .where(eq(exports.podcastId, podcastId))
      .limit(1)
      .get();
    if (exportRow) exportPrefix = getExportPathPrefix(exportRow);
  }
  const publicBaseNoSlash = publicBase ? publicBase.replace(/\/$/, "") : "";
  if (!publicBaseNoSlash) return null;
  const slugRaw = String(podcast.slug ?? "").trim();
  if (exportPrefix != null) {
    return exportPrefix
      ? `${publicBaseNoSlash}/${exportPrefix}/${RSS_FEED_FILENAME}`
      : `${publicBaseNoSlash}/${RSS_FEED_FILENAME}`;
  }
  if (!slugRaw) return null;
  const slugEnc = encodeURIComponent(slugRaw);
  const rssFeedUrl = `${publicBaseNoSlash}/${API_PREFIX}/public/podcasts/${slugEnc}/rss`;
  return atomLinkSelfHref({
    rssFeedUrl,
    exportPrefix,
    podcast,
    slugEnc,
    slugRaw,
  });
}

export function writeRssFile(
  podcastId: string,
  publicBaseUrl?: string | null,
): string {
  const xml = generateRss(podcastId, publicBaseUrl);
  writeRssToFile(podcastId, xml);
  return join(rssDir(podcastId), RSS_FEED_FILENAME);
}

/** Write pre-generated XML to the RSS feed file (data/rss/:podcastId/<RSS_FEED_FILENAME>). */
export function writeRssToFile(podcastId: string, xml: string): void {
  const dir = rssDir(podcastId);
  const path = join(dir, RSS_FEED_FILENAME);
  assertResolvedPathUnder(path, dir);
  writeFileSync(path, xml, "utf8");
}

/** Absolute xml-stylesheet hrefs break browser preview on custom domains. */
function hasCrossOriginStylesheet(xml: string): boolean {
  return /<\?xml-stylesheet[^>]+href="https?:\/\//.test(xml);
}

/**
 * Return cached RSS XML if the feed file exists and is newer than maxAgeMs.
 * Otherwise return null (caller should generate and save).
 */
export function getCachedRssIfFresh(
  podcastId: string,
  maxAgeMs: number,
): string | null {
  const dir = rssDir(podcastId);
  const path = join(dir, RSS_FEED_FILENAME);
  assertResolvedPathUnder(path, dir);
  if (!existsSync(path)) return null;
  try {
    const safePath = assertPathUnder(path, dir);
    const stat = statSync(safePath);
    const age = Date.now() - stat.mtimeMs;
    if (age >= maxAgeMs) return null;
    const xml = readFileSync(safePath, "utf8");
    if (hasCrossOriginStylesheet(xml)) return null;
    return xml;
  } catch {
    return null;
  }
}

/** Generate token feed XML template (includes subscriber-only episodes; URLs use SUBSCRIBER_TOKEN_ID_PLACEHOLDER). */
export function generateTokenFeedTemplate(podcastId: string): string {
  return generateRss(podcastId, null, {
    includeSubscriberOnlyEpisodes: true,
    tokenIdPlaceholder: SUBSCRIBER_TOKEN_ID_PLACEHOLDER,
  });
}

/** Write token feed template XML to data/rss/:podcastId/private-feed-template.xml. */
export function writeTokenFeedTemplateToFile(
  podcastId: string,
  xml: string,
): void {
  const dir = rssDir(podcastId);
  const path = join(dir, PRIVATE_FEED_TEMPLATE_FILENAME);
  assertResolvedPathUnder(path, dir);
  writeFileSync(path, xml, "utf8");
}

/** Return cached token feed template if file exists and is newer than maxAgeMs; else null. */
export function getCachedTokenFeedTemplateIfFresh(
  podcastId: string,
  maxAgeMs: number,
): string | null {
  const dir = rssDir(podcastId);
  const path = join(dir, PRIVATE_FEED_TEMPLATE_FILENAME);
  assertResolvedPathUnder(path, dir);
  if (!existsSync(path)) return null;
  try {
    const safePath = assertPathUnder(path, dir);
    const stat = statSync(safePath);
    const age = Date.now() - stat.mtimeMs;
    if (age >= maxAgeMs) return null;
    return readFileSync(safePath, "utf8");
  } catch {
    return null;
  }
}

/** Get or create token feed template; returns XML string with placeholder. Caller replaces placeholder with token id. */
export function getOrCreateTokenFeedTemplate(
  podcastId: string,
  maxAgeMs: number,
): string {
  const cached = getCachedTokenFeedTemplateIfFresh(podcastId, maxAgeMs);
  if (cached) return cached;
  const xml = generateTokenFeedTemplate(podcastId);
  writeTokenFeedTemplateToFile(podcastId, xml);
  return xml;
}

/** Delete the token feed template file so next request regenerates it. */
export function deleteTokenFeedTemplateFile(podcastId: string): void {
  const dir = rssDir(podcastId);
  const path = join(dir, PRIVATE_FEED_TEMPLATE_FILENAME);
  try {
    if (existsSync(path)) {
      const safePath = assertPathUnder(path, dir);
      unlinkSync(safePath);
    }
  } catch {
    // ignore
  }
}
