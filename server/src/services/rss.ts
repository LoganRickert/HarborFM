import {
  existsSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { basename, extname, join } from "path";
import { db } from "../db/index.js";
import { getExportPathPrefix } from "./export-config.js";
import {
  assertPathUnder,
  assertResolvedPathUnder,
  getDataDir,
  rssDir,
} from "./paths.js";
import { EXT_DOT_TO_EXT } from "../utils/artwork.js";
import { API_PREFIX, APP_NAME, RSS_FEED_FILENAME } from "../config.js";

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

export function generateRss(
  podcastId: string,
  publicBaseUrl?: string | null,
  options?: GenerateRssOptions,
): string {
  const opts = options ?? {};
  const includeSubscriberOnly = opts.includeSubscriberOnlyEpisodes === true;
  const tokenIdPlaceholder = opts.tokenIdPlaceholder;

  const podcast = db
    .prepare("SELECT * FROM podcasts WHERE id = ?")
    .get(podcastId) as Record<string, unknown> | undefined;
  if (!podcast) throw new Error("Podcast not found");

  // If no publicBaseUrl provided, try to get one from exports or hostname setting
  let publicBase = sanitizeHttpUrl(publicBaseUrl);
  let exportPrefix: string | null = null;
  if (!publicBase) {
    const exportWithUrl = db
      .prepare(
        "SELECT id, podcast_id, mode, name, public_base_url, config_enc FROM exports WHERE podcast_id = ? AND public_base_url IS NOT NULL AND LENGTH(public_base_url) > 0 LIMIT 1",
      )
      .get(podcastId) as Record<string, unknown> | undefined;
    if (exportWithUrl?.public_base_url) {
      publicBase = sanitizeHttpUrl(exportWithUrl.public_base_url);
      exportPrefix = getExportPathPrefix(exportWithUrl);
    } else {
      // If no S3 export, check for hostname setting (for self-hosted MP3s)
      const hostnameSetting = db
        .prepare("SELECT value FROM settings WHERE key = ?")
        .get("hostname") as { value: string } | undefined;
      if (hostnameSetting?.value && hostnameSetting.value.trim()) {
        publicBase = sanitizeHttpUrl(hostnameSetting.value);
      }
      // If neither S3 export nor hostname setting is configured, no enclosure URL will be included
    }
  } else {
    const exportRow = db
      .prepare(
        "SELECT id, podcast_id, mode, name, public_base_url, config_enc FROM exports WHERE podcast_id = ? LIMIT 1",
      )
      .get(podcastId) as Record<string, unknown> | undefined;
    if (exportRow) {
      exportPrefix = getExportPathPrefix(exportRow);
    }
  }

  // Token feed: always use app hostname for URLs (no S3); need base URL for placeholder paths
  if (tokenIdPlaceholder) {
    const hostnameSetting = db
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get("hostname") as { value: string } | undefined;
    const hostBase = hostnameSetting?.value?.trim()
      ? sanitizeHttpUrl(hostnameSetting.value.trim())
      : "";
    if (hostBase) publicBase = hostBase;
    exportPrefix = null; // token feed URLs are app paths only
  }

  const episodeFilter = includeSubscriberOnly
    ? ""
    : " AND (COALESCE(subscriber_only, 0) = 0)";
  const episodes = db
    .prepare(
      `SELECT * FROM episodes WHERE podcast_id = ? AND status = 'published'
       AND (publish_at IS NULL OR datetime(publish_at) <= datetime('now'))${episodeFilter}
       ORDER BY publish_at DESC, created_at DESC LIMIT 300`,
    )
    .all(podcastId) as Record<string, unknown>[];

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
    String(podcast.author_name ?? podcast.owner_name ?? ""),
  );
  const ownerName = escapeCdata(String(podcast.owner_name ?? ""));
  const emailRaw = String(podcast.email ?? "").trim();
  const email = escapeXml(emailRaw);
  const categoryPrimary = escapeXml(String(podcast.category_primary ?? ""));
  const categorySecondary = podcast.category_secondary
    ? escapeXml(String(podcast.category_secondary))
    : "";
  const categoryPrimaryTwo = podcast.category_primary_two
    ? escapeXml(String(podcast.category_primary_two))
    : "";
  const categorySecondaryTwo = podcast.category_secondary_two
    ? escapeXml(String(podcast.category_secondary_two))
    : "";
  const categoryPrimaryThree = podcast.category_primary_three
    ? escapeXml(String(podcast.category_primary_three))
    : "";
  const categorySecondaryThree = podcast.category_secondary_three
    ? escapeXml(String(podcast.category_secondary_three))
    : "";
  const explicit = (podcast.explicit as number) === 1 ? "true" : "false";
  const siteUrl = sanitizeHttpUrl(podcast.site_url);
  const slugRaw = stripControlChars(String(podcast.slug ?? "")).trim();
  const copyright = podcast.copyright
    ? escapeXml(String(podcast.copyright))
    : "";
  const podcastGuid = podcast.podcast_guid
    ? escapeXml(String(podcast.podcast_guid))
    : "";
  const locked = (podcast.locked as number) === 1 ? "yes" : "no";
  const license = podcast.license ? escapeCdata(String(podcast.license)) : "";
  const itunesType = escapeXml(
    String((podcast.itunes_type as string) || "episodic"),
  );
  const medium = escapeXml(String((podcast.medium as string) || "podcast"));

  const publicBaseNoSlash = publicBase ? publicBase.replace(/\/$/, "") : "";

  // Base URL for app feed pages (channel link and episode links when site_url / episode_link not set)
  const hostnameRow = db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get("hostname") as { value: string } | undefined;
  const feedBaseUrlRaw = hostnameRow?.value?.trim()
    ? sanitizeHttpUrl(hostnameRow.value.trim())
    : "";
  const feedBaseUrl = feedBaseUrlRaw ? feedBaseUrlRaw.replace(/\/+$/, "") : "";

  const websubDiscoveryEnabledRow = db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get("websub_discovery_enabled") as { value: string } | undefined;
  const websubDiscoveryEnabled = websubDiscoveryEnabledRow?.value === "true";
  const websubHubRow = db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get("websub_hub") as { value: string } | undefined;
  const websubHubUrl =
    websubDiscoveryEnabled && websubHubRow?.value?.trim()
      ? sanitizeHttpUrl(websubHubRow.value.trim())
      : "";

  const slugEnc = encodeURIComponent(slugRaw);

  let artworkUrl = "";
  // Prefer artwork_url if set, otherwise use artwork_path if available
  if (podcast.artwork_url) {
    artworkUrl = sanitizeHttpUrl(podcast.artwork_url);
  } else if (podcast.artwork_path && publicBaseNoSlash) {
    if (tokenIdPlaceholder) {
      const filename = basename(podcast.artwork_path as string);
      artworkUrl = `${publicBaseNoSlash}/${API_PREFIX}/public/podcasts/${slugEnc}/private/${tokenIdPlaceholder}/artwork/${encodeURIComponent(filename)}`;
    } else if (exportPrefix != null) {
      const ext = artworkExt(podcast.artwork_path as string);
      artworkUrl = exportPrefix
        ? `${publicBaseNoSlash}/${exportPrefix}/cover.${ext}`
        : `${publicBaseNoSlash}/cover.${ext}`;
    } else {
      const filename = basename(podcast.artwork_path as string);
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

  const nowRfc2822 = new Date().toUTCString();
  const lastBuildDate =
    episodes.length > 0
      ? episodes[0].publish_at
        ? new Date(String(episodes[0].publish_at)).toUTCString()
        : new Date(String(episodes[0].updated_at)).toUTCString()
      : nowRfc2822;

  // When no podcast site_url is set, use the public feed URL (app hostname + /feed/slug)
  const fallbackSiteUrl =
    feedBaseUrl && slugRaw
      ? `${feedBaseUrl}/feed/${encodeURIComponent(slugRaw)}`
      : "";
  const channelLink = siteUrl || fallbackSiteUrl;

  const stylesheetHref =
    exportPrefix == null && publicBaseNoSlash
      ? `${publicBaseNoSlash}/style.xsl`
      : exportPrefix == null
        ? "/style.xsl"
        : "";
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
  if (rssFeedUrl) {
    out += `    <atom:link href="${escapeXml(rssFeedUrl)}" rel="self" type="application/rss+xml"/>\n`;
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
    podcast.funding_url != null ? sanitizeHttpUrl(podcast.funding_url) : "";
  if (fundingUrl) {
    const fundingLabel =
      podcast.funding_label != null
        ? escapeCdata(String(podcast.funding_label).trim())
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
    podcast.update_frequency_rrule != null
      ? String(podcast.update_frequency_rrule).trim()
      : "";
  if (updateRrule) {
    const updateLabel =
      podcast.update_frequency_label != null
        ? escapeCdata(String(podcast.update_frequency_label).trim())
        : "";
    out += `    <podcast:updateFrequency rrule="${escapeXml(updateRrule)}">${updateLabel ? `<![CDATA[${updateLabel}]]>` : ""}</podcast:updateFrequency>\n`;
  }
  const spotifyCount = podcast.spotify_recent_count;
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
    podcast.spotify_country_of_origin != null
      ? String(podcast.spotify_country_of_origin).trim()
      : "";
  if (spotifyCountry)
    out += `    <spotify:countryOfOrigin>${escapeXml(spotifyCountry)}</spotify:countryOfOrigin>\n`;
  const appleVerify =
    podcast.apple_podcasts_verify != null
      ? String(podcast.apple_podcasts_verify).trim()
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

  for (const ep of episodes) {
    const epTitle = escapeCdata(String(ep.title ?? ""));
    const baseDesc = String(ep.description ?? "");
    const snapshot =
      ep.description_copyright_snapshot != null
        ? String(ep.description_copyright_snapshot).trim()
        : "";
    const epDesc = escapeCdata(
      snapshot ? `${baseDesc}\r\n\r\nMusic:\r\n${snapshot}` : baseDesc,
    );
    const epSummaryRaw = ep.summary != null ? String(ep.summary).trim() : "";
    const epSummary = epSummaryRaw ? escapeCdata(epSummaryRaw) : "";
    const epSubtitleRaw = ep.subtitle != null ? String(ep.subtitle).trim() : "";
    const epSubtitle = epSubtitleRaw ? escapeCdata(epSubtitleRaw) : "";
    const epContentEncoded =
      ep.content_encoded != null ? String(ep.content_encoded).trim() : "";
    const guid = escapeXml(String(ep.guid ?? ep.id));
    const pubDate = ep.publish_at
      ? new Date(String(ep.publish_at)).toUTCString()
      : new Date(String(ep.updated_at)).toUTCString();
    const epExplicit =
      (ep.explicit as number) === 1
        ? "true"
        : (podcast.explicit as number) === 1
          ? "true"
          : "false";
    const duration =
      ep.audio_duration_sec != null ? Number(ep.audio_duration_sec) : 0;
    const season = ep.season_number != null ? Number(ep.season_number) : null;
    const episodeNum =
      ep.episode_number != null ? Number(ep.episode_number) : null;
    const episodeType = (ep.episode_type as string) || "full";

    let enclosureUrl = "";
    if (publicBaseNoSlash && ep.id) {
      const validEpisodeId = String(ep.id).trim();
      if (validEpisodeId) {
        const ext = enclosureExt(ep.audio_final_path);
        if (tokenIdPlaceholder && slugRaw) {
          enclosureUrl = `${publicBaseNoSlash}/${API_PREFIX}/public/podcasts/${slugEnc}/private/${tokenIdPlaceholder}/episodes/${encodeURIComponent(validEpisodeId)}${ext}`;
        } else if (exportPrefix != null) {
          // S3 export: public base + prefix + episodes/{id}.ext (matches deployPodcastToS3 keys)
          enclosureUrl = `${publicBaseNoSlash}/${exportPrefix}/episodes/${validEpisodeId}${ext}`;
        } else if (ep.audio_final_path && podcastId) {
          // Self-hosted: API path with file extension so enclosure URLs end in .mp3 etc.
          const validPodcastId = String(podcastId).trim();
          if (validPodcastId) {
            enclosureUrl = `${publicBaseNoSlash}/${API_PREFIX}/${encodeURIComponent(validPodcastId)}/episodes/${encodeURIComponent(validEpisodeId)}${ext}`;
          }
        }
      }
    }

    const epLink = sanitizeHttpUrl(ep.episode_link);
    const epSlugRaw =
      ep.slug != null ? stripControlChars(String(ep.slug)).trim() : "";
    const fallbackEpLink =
      feedBaseUrl && slugRaw && epSlugRaw
        ? `${feedBaseUrl}/feed/${encodeURIComponent(slugRaw)}/${encodeURIComponent(epSlugRaw)}`
        : channelLink;
    const itemLink = epLink || fallbackEpLink;
    const guidIsPermaLink = (ep.guid_is_permalink as number) === 1;

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
      const bytes = ep.audio_bytes != null ? Number(ep.audio_bytes) : 0;
      const enclosureType =
        typeof ep.audio_mime === "string" && ep.audio_mime
          ? ep.audio_mime
          : "audio/mpeg";
      out += `      <enclosure url="${escapeXml(enclosureUrl)}" length="${bytes}" type="${escapeXml(enclosureType)}"/>\n`;
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
    if (ep.artwork_url) {
      epArtworkUrl = sanitizeHttpUrl(ep.artwork_url);
    } else if (ep.artwork_path && publicBaseNoSlash && ep.id) {
      if (tokenIdPlaceholder && slugRaw) {
        const filename = basename(String(ep.artwork_path));
        epArtworkUrl = `${publicBaseNoSlash}/${API_PREFIX}/public/podcasts/${slugEnc}/private/${tokenIdPlaceholder}/artwork/episodes/${encodeURIComponent(String(ep.id))}/${encodeURIComponent(filename)}`;
      } else if (exportPrefix != null) {
        const ext = artworkExt(ep.artwork_path as string);
        epArtworkUrl = `${publicBaseNoSlash}/${exportPrefix}/episodes/${String(ep.id)}.${ext}`;
      } else if (podcastId) {
        const filename = basename(String(ep.artwork_path));
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
  const podcast = db
    .prepare("SELECT slug FROM podcasts WHERE id = ?")
    .get(podcastId) as { slug: string | null } | undefined;
  if (!podcast?.slug) return null;
  let publicBase = sanitizeHttpUrl(publicBaseUrl);
  let exportPrefix: string | null = null;
  if (!publicBase) {
    const exportWithUrl = db
      .prepare(
        "SELECT id, podcast_id, mode, name, public_base_url, config_enc FROM exports WHERE podcast_id = ? AND public_base_url IS NOT NULL AND LENGTH(public_base_url) > 0 LIMIT 1",
      )
      .get(podcastId) as Record<string, unknown> | undefined;
    if (exportWithUrl?.public_base_url) {
      publicBase = sanitizeHttpUrl(exportWithUrl.public_base_url);
      exportPrefix = getExportPathPrefix(exportWithUrl);
    } else {
      const hostnameSetting = db
        .prepare("SELECT value FROM settings WHERE key = ?")
        .get("hostname") as { value: string } | undefined;
      if (hostnameSetting?.value?.trim())
        publicBase = sanitizeHttpUrl(hostnameSetting.value);
    }
  } else {
    const exportRow = db
      .prepare(
        "SELECT id, podcast_id, mode, name, public_base_url, config_enc FROM exports WHERE podcast_id = ? LIMIT 1",
      )
      .get(podcastId) as Record<string, unknown> | undefined;
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
  if (slugRaw)
    return `${publicBaseNoSlash}/${API_PREFIX}/public/podcasts/${encodeURIComponent(slugRaw)}/rss`;
  return null;
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
    return readFileSync(safePath, "utf8");
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
