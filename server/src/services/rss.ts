import {
  existsSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { basename, extname, join } from "path";
import { drizzleDb } from "../db/index.js";
import { and, desc, eq, sql } from "drizzle-orm";
import { episodes, exports, podcasts, settings } from "../db/schema.js";
import { getExportPathPrefix } from "./export-config.js";
import {
  assertPathUnder,
  assertResolvedPathUnder,
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
  const explicit = podcast.explicit ? "yes" : "no";
  const siteUrl = sanitizeHttpUrl(podcast.siteUrl);
  const slugRaw = stripControlChars(String(podcast.slug ?? "")).trim();
  const copyright = podcast.copyright
    ? escapeXml(String(podcast.copyright))
    : "";
  const podcastGuid = podcast.podcastGuid
    ? escapeXml(String(podcast.podcastGuid))
    : "";
  const locked = podcast.locked ? "yes" : "no";
  const license = podcast.license ? escapeCdata(String(podcast.license)) : "";
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
  if (license)
    out += `    <podcast:license><![CDATA[${license}]]></podcast:license>\n`;
  const fundingUrl =
    podcast.fundingUrl != null ? sanitizeHttpUrl(podcast.fundingUrl) : "";
  if (fundingUrl) {
    const fundingLabel =
      podcast.fundingLabel != null
        ? escapeCdata(String(podcast.fundingLabel).trim())
        : "";
    out += `    <podcast:funding url="${escapeXml(fundingUrl)}">${fundingLabel ? `<![CDATA[${fundingLabel}]]>` : ""}</podcast:funding>\n`;
  }
  const personsJson = podcast.persons;
  if (personsJson && typeof personsJson === "string") {
    try {
      const arr = JSON.parse(personsJson) as unknown[];
      if (Array.isArray(arr)) {
        for (const p of arr) {
          if (typeof p === "string" && p.trim())
            out += `    <podcast:person><![CDATA[${escapeCdata(p.trim())}]]></podcast:person>\n`;
        }
      }
    } catch {
      // ignore invalid JSON
    }
  }
  const updateRrule =
    podcast.updateFrequencyRrule != null
      ? String(podcast.updateFrequencyRrule).trim()
      : "";
  if (updateRrule) {
    const updateLabel =
      podcast.updateFrequencyLabel != null
        ? escapeCdata(String(podcast.updateFrequencyLabel).trim())
        : "";
    out += `    <podcast:updateFrequency rrule="${escapeXml(updateRrule)}">${updateLabel ? `<![CDATA[${updateLabel}]]>` : ""}</podcast:updateFrequency>\n`;
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
      ep.explicit === true
        ? "yes"
        : podcast.explicit
          ? "yes"
          : "no";
    const duration =
      ep.audioDurationSec != null ? Number(ep.audioDurationSec) : 0;
    const season = ep.seasonNumber != null ? Number(ep.seasonNumber) : null;
    const episodeNum =
      ep.episodeNumber != null ? Number(ep.episodeNumber) : null;
    const episodeType = (ep.episodeType as string) || "full";

    let enclosureUrl = "";
    if (publicBaseNoSlash && ep.id) {
      const validEpisodeId = String(ep.id).trim();
      if (validEpisodeId) {
        const ext = enclosureExt(ep.audioFinalPath);
        if (tokenIdPlaceholder && slugRaw) {
          enclosureUrl = `${publicBaseNoSlash}/${API_PREFIX}/public/podcasts/${slugEnc}/private/${tokenIdPlaceholder}/episodes/${encodeURIComponent(validEpisodeId)}${ext}`;
        } else if (exportPrefix != null) {
          // S3 export: public base + prefix + episodes/{id}.ext (matches deployPodcastToS3 keys)
          enclosureUrl = `${publicBaseNoSlash}/${exportPrefix}/episodes/${validEpisodeId}${ext}`;
        } else if (ep.audioFinalPath && podcastId) {
          // Self-hosted: API path with file extension so enclosure URLs end in .mp3 etc.
          const validPodcastId = String(podcastId).trim();
          if (validPodcastId) {
            enclosureUrl = `${publicBaseNoSlash}/${API_PREFIX}/${encodeURIComponent(validPodcastId)}/episodes/${encodeURIComponent(validEpisodeId)}${ext}`;
          }
        }
      }
    }

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
