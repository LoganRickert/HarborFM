import { writeFileSync } from 'fs';
import { basename, extname } from 'path';
import { db } from '../db/index.js';
import { rssDir } from './paths.js';
import { EXT_DOT_TO_EXT } from '../utils/artwork.js';

function artworkExt(artworkPath: string | null | undefined): string {
  if (!artworkPath) return 'jpg';
  const ext = extname(String(artworkPath)).toLowerCase();
  return EXT_DOT_TO_EXT[ext] ?? 'jpg';
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function escapeCdata(s: string): string {
  return s.replace(/\]\]>/g, ']]]]><![CDATA[>');
}

function stripControlChars(s: string): string {
  // Keep it "plain text": remove control chars (incl. newlines) that can break XML.
  return s.replace(/[\u0000-\u001F\u007F]/g, ''); // eslint-disable-line no-control-regex
}

/**
 * "Good enough" URL sanitizer for RSS output:
 * - absolute URLs only
 * - protocol must be http/https
 * - strip control characters
 * - reject credentials (user:pass@host) to avoid leaking secrets into feeds
 */
function sanitizeHttpUrl(input: unknown): string {
  if (typeof input !== 'string') return '';
  const raw = stripControlChars(input).trim();
  if (!raw) return '';
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    if (u.username || u.password) return '';
    return u.toString();
  } catch {
    return '';
  }
}

export function generateRss(podcastId: string, publicBaseUrl?: string | null): string {
  const podcast = db.prepare('SELECT * FROM podcasts WHERE id = ?').get(podcastId) as Record<string, unknown> | undefined;
  if (!podcast) throw new Error('Podcast not found');
  
  // If no publicBaseUrl provided, try to get one from exports or hostname setting
  let publicBase = sanitizeHttpUrl(publicBaseUrl);
  let exportPrefix: string | null = null;
  if (!publicBase) {
    const exportWithUrl = db
      .prepare('SELECT public_base_url, prefix FROM exports WHERE podcast_id = ? AND public_base_url IS NOT NULL AND LENGTH(public_base_url) > 0 LIMIT 1')
      .get(podcastId) as { public_base_url: string; prefix: string | null } | undefined;
    if (exportWithUrl?.public_base_url) {
      // S3 export takes priority
      publicBase = sanitizeHttpUrl(exportWithUrl.public_base_url);
      const raw = exportWithUrl.prefix != null ? String(exportWithUrl.prefix).trim() : '';
      exportPrefix = raw ? raw.replace(/^\/|\/$/g, '') : null;
    } else {
      // If no S3 export, check for hostname setting (for self-hosted MP3s)
      const hostnameSetting = db
        .prepare('SELECT value FROM settings WHERE key = ?')
        .get('hostname') as { value: string } | undefined;
      if (hostnameSetting?.value && hostnameSetting.value.trim()) {
        publicBase = sanitizeHttpUrl(hostnameSetting.value);
      }
      // If neither S3 export nor hostname setting is configured, no enclosure URL will be included
    }
  } else {
    // publicBaseUrl was passed in (e.g. from deploy); get prefix from export for S3 enclosure URLs
    const exportRow = db
      .prepare('SELECT prefix FROM exports WHERE podcast_id = ? LIMIT 1')
      .get(podcastId) as { prefix: string | null } | undefined;
    if (exportRow?.prefix != null) {
      const raw = String(exportRow.prefix).trim();
      exportPrefix = raw ? raw.replace(/^\/|\/$/g, '') : null;
    }
  }
  
  const episodes = db
    .prepare(
      `SELECT * FROM episodes WHERE podcast_id = ? AND status = 'published'
       AND (publish_at IS NULL OR datetime(publish_at) <= datetime('now'))
       ORDER BY publish_at DESC, created_at DESC LIMIT 300`
    )
    .all(podcastId) as Record<string, unknown>[];

  const titleRaw = String(podcast.title ?? '');
  const title = escapeCdata(titleRaw);
  const description = escapeCdata(String(podcast.description ?? ''));
  const language = escapeXml(String(podcast.language ?? 'en'));
  const author = escapeCdata(String(podcast.author_name ?? podcast.owner_name ?? ''));
  const ownerName = escapeCdata(String(podcast.owner_name ?? ''));
  const emailRaw = String(podcast.email ?? '').trim();
  const email = escapeXml(emailRaw);
  const categoryPrimary = escapeXml(String(podcast.category_primary ?? ''));
  const categorySecondary = podcast.category_secondary
    ? escapeXml(String(podcast.category_secondary))
    : '';
  const categoryTertiary = podcast.category_tertiary
    ? escapeXml(String(podcast.category_tertiary))
    : '';
  const explicit = (podcast.explicit as number) === 1 ? 'true' : 'false';
  const siteUrl = sanitizeHttpUrl(podcast.site_url);
  const slugRaw = stripControlChars(String(podcast.slug ?? '')).trim();
  const copyright = podcast.copyright ? escapeXml(String(podcast.copyright)) : '';
  const podcastGuid = podcast.podcast_guid ? escapeXml(String(podcast.podcast_guid)) : '';
  const locked = (podcast.locked as number) === 1 ? 'yes' : 'no';
  const license = podcast.license ? escapeCdata(String(podcast.license)) : '';
  const itunesType = escapeXml(String((podcast.itunes_type as string) || 'episodic'));
  const medium = escapeXml(String((podcast.medium as string) || 'podcast'));

  const publicBaseNoSlash = publicBase ? publicBase.replace(/\/$/, '') : '';

  // Base URL for app feed pages (channel link and episode links when site_url / episode_link not set)
  const hostnameRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('hostname') as { value: string } | undefined;
  const feedBaseUrlRaw = hostnameRow?.value?.trim() ? sanitizeHttpUrl(hostnameRow.value.trim()) : '';
  const feedBaseUrl = feedBaseUrlRaw ? feedBaseUrlRaw.replace(/\/+$/, '') : '';

  let artworkUrl = '';
  // Prefer artwork_url if set, otherwise use artwork_path if available
  if (podcast.artwork_url) {
    artworkUrl = sanitizeHttpUrl(podcast.artwork_url);
  } else if (podcast.artwork_path && publicBaseNoSlash) {
    if (exportPrefix != null) {
      const ext = artworkExt(podcast.artwork_path as string);
      artworkUrl = exportPrefix
        ? `${publicBaseNoSlash}/${exportPrefix}/cover.${ext}`
        : `${publicBaseNoSlash}/cover.${ext}`;
    } else {
      const filename = basename(podcast.artwork_path as string);
      artworkUrl = `${publicBaseNoSlash}/api/public/artwork/${encodeURIComponent(podcastId)}/${encodeURIComponent(filename)}`;
    }
  }

  // Build RSS feed URL (atom:link rel="self"): S3 feed URL when deployed there, else app API URL
  let rssFeedUrl = '';
  if (publicBaseNoSlash) {
    if (exportPrefix != null) {
      rssFeedUrl = exportPrefix ? `${publicBaseNoSlash}/${exportPrefix}/feed.xml` : `${publicBaseNoSlash}/feed.xml`;
    } else if (slugRaw) {
      rssFeedUrl = `${publicBaseNoSlash}/api/public/podcasts/${encodeURIComponent(slugRaw)}/rss`;
    }
  }

  const nowRfc2822 = new Date().toUTCString();
  const lastBuildDate = episodes.length > 0
    ? (episodes[0].publish_at
        ? new Date(String(episodes[0].publish_at)).toUTCString()
        : new Date(String(episodes[0].updated_at)).toUTCString())
    : nowRfc2822;

  // When no podcast site_url is set, use the public feed URL (app hostname + /feed/slug)
  const fallbackSiteUrl = feedBaseUrl && slugRaw ? `${feedBaseUrl}/feed/${encodeURIComponent(slugRaw)}` : '';
  const channelLink = siteUrl || fallbackSiteUrl;

  const stylesheetHref =
    exportPrefix == null && publicBaseNoSlash
      ? `${publicBaseNoSlash}/style.xsl`
      : exportPrefix == null
        ? '/style.xsl'
        : '';
  // Omit xml-stylesheet when feed is for S3 deploy (style.xsl is not uploaded there)
  const stylesheetPi = stylesheetHref
    ? `<?xml-stylesheet type="text/xsl" href="${escapeXml(stylesheetHref)}"?>\n`
    : '';

  let out = `<?xml version="1.0" encoding="UTF-8"?>
${stylesheetPi}<rss xmlns:podcast="https://podcastindex.org/namespace/1.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:psc="http://podlove.org/simple-chapters" xmlns:atom="http://www.w3.org/2005/Atom" xml:lang="${language}" version="2.0">
  <channel>
    <title><![CDATA[${title}]]></title>
`;
  if (channelLink) out += `    <link>${escapeXml(channelLink)}</link>\n`;
  if (rssFeedUrl) {
    out += `    <atom:link href="${escapeXml(rssFeedUrl)}" rel="self" type="application/rss+xml"/>\n`;
  }
  out += `    <description><![CDATA[${description}]]></description>
    <generator>HarborFM</generator>
    <lastBuildDate>${lastBuildDate}</lastBuildDate>
    <language>${language}</language>
`;
  if (copyright) out += `    <copyright><![CDATA[${escapeCdata(String(podcast.copyright))}]]></copyright>\n`;
  if (artworkUrl) out += `    <itunes:image href="${escapeXml(artworkUrl)}"/>\n`;
  if (podcastGuid) out += `    <podcast:guid>${podcastGuid}</podcast:guid>\n`;
  if (artworkUrl) {
    out += `    <image>
      <url>${escapeXml(artworkUrl)}</url>
      <title><![CDATA[${title}]]></title>
${channelLink ? `      <link>${escapeXml(channelLink)}</link>\n` : ''}    </image>
`;
  }
  out += `    <podcast:locked>${locked}</podcast:locked>\n`;
  if (license) out += `    <podcast:license><![CDATA[${license}]]></podcast:license>\n`;
  out += `    <itunes:author><![CDATA[${author}]]></itunes:author>
    <itunes:owner>
      <itunes:name><![CDATA[${ownerName}]]></itunes:name>
${emailRaw ? `      <itunes:email>${email}</itunes:email>\n` : ''}    </itunes:owner>
    <itunes:explicit>${explicit}</itunes:explicit>
    <itunes:type>${itunesType}</itunes:type>
`;

  // Categories - mimic hosted feeds: primary nests secondary; tertiary becomes an additional top-level category.
  if (categoryPrimary && categorySecondary) {
    out += `    <itunes:category text="${categoryPrimary}">
      <itunes:category text="${categorySecondary}"/>
    </itunes:category>
`;
  } else if (categoryPrimary) {
    out += `    <itunes:category text="${categoryPrimary}"/>\n`;
  }
  if (categoryTertiary) {
    out += `    <itunes:category text="${categoryTertiary}"/>\n`;
  }

  out += `    <podcast:medium>${medium}</podcast:medium>
`;

  for (const ep of episodes) {
    const epTitle = escapeCdata(String(ep.title ?? ''));
    const epDesc = escapeCdata(String(ep.description ?? ''));
    const guid = escapeXml(String(ep.guid ?? ep.id));
    const pubDate = ep.publish_at
      ? new Date(String(ep.publish_at)).toUTCString()
      : new Date(String(ep.updated_at)).toUTCString();
    const epExplicit = (ep.explicit as number) === 1 ? 'true' : (podcast.explicit as number) === 1 ? 'true' : 'false';
    const duration = ep.audio_duration_sec != null ? Number(ep.audio_duration_sec) : 0;
    const season = ep.season_number != null ? Number(ep.season_number) : null;
    const episodeNum = ep.episode_number != null ? Number(ep.episode_number) : null;
    const episodeType = (ep.episode_type as string) || 'full';

    let enclosureUrl = '';
    if (publicBaseNoSlash && ep.id) {
      const validEpisodeId = String(ep.id).trim();
      if (validEpisodeId) {
        if (exportPrefix != null) {
          // S3 export: public base + prefix + episodes/{id}.ext (matches deployPodcastToS3 keys)
          const ext = ep.audio_final_path ? (extname(String(ep.audio_final_path)) || '.mp3') : '.mp3';
          enclosureUrl = `${publicBaseNoSlash}/${exportPrefix}/episodes/${validEpisodeId}${ext}`;
        } else if (ep.audio_final_path && podcastId) {
          // Self-hosted: API path (no file extension)
          const validPodcastId = String(podcastId).trim();
          if (validPodcastId) {
            enclosureUrl = `${publicBaseNoSlash}/api/${encodeURIComponent(validPodcastId)}/episodes/${encodeURIComponent(validEpisodeId)}`;
          }
        }
      }
    }

    const epLink = sanitizeHttpUrl(ep.episode_link);
    const epSlugRaw = ep.slug != null ? stripControlChars(String(ep.slug)).trim() : '';
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
    if (itemLink) out += `      <link>${escapeXml(itemLink)}</link>\n`;
    if (enclosureUrl) {
      const bytes = ep.audio_bytes != null ? Number(ep.audio_bytes) : 0;
      const enclosureType = typeof ep.audio_mime === 'string' && ep.audio_mime ? ep.audio_mime : 'audio/mpeg';
      out += `      <enclosure url="${escapeXml(enclosureUrl)}" length="${bytes}" type="${escapeXml(enclosureType)}"/>\n`;
    }
    out += `      <guid isPermaLink="${guidIsPermaLink}">${guid}</guid>
`;
    if (duration > 0) out += `      <itunes:duration>${duration}</itunes:duration>\n`;
    out += `      <itunes:episodeType>${escapeXml(episodeType)}</itunes:episodeType>\n`;
    if (season != null) {
      out += `      <itunes:season>${season}</itunes:season>\n`;
      out += `      <podcast:season>${season}</podcast:season>\n`;
    }
    if (episodeNum != null) {
      out += `      <itunes:episode>${episodeNum}</itunes:episode>\n`;
      out += `      <podcast:episode>${episodeNum}</podcast:episode>\n`;
    }
    let epArtworkUrl = '';
    if (ep.artwork_url) {
      epArtworkUrl = sanitizeHttpUrl(ep.artwork_url);
    } else if (ep.artwork_path && publicBaseNoSlash && ep.id) {
      if (exportPrefix != null) {
        const ext = artworkExt(ep.artwork_path as string);
        epArtworkUrl = `${publicBaseNoSlash}/${exportPrefix}/episodes/${String(ep.id)}.${ext}`;
      } else if (podcastId) {
        const filename = basename(String(ep.artwork_path));
        epArtworkUrl = `${publicBaseNoSlash}/api/public/artwork/${encodeURIComponent(podcastId)}/episodes/${encodeURIComponent(String(ep.id))}/${encodeURIComponent(filename)}`;
      }
    }
    if (epArtworkUrl) out += `      <itunes:image href="${escapeXml(epArtworkUrl)}"/>\n`;
    out += `      <itunes:explicit>${epExplicit}</itunes:explicit>
      <pubDate>${pubDate}</pubDate>
    </item>
`;
  }

  out += `  </channel>
</rss>`;
  return out;
}

export function writeRssFile(podcastId: string, publicBaseUrl?: string | null): string {
  const xml = generateRss(podcastId, publicBaseUrl);
  const dir = rssDir(podcastId);
  const path = `${dir}/feed.xml`;
  writeFileSync(path, xml, 'utf8');
  return path;
}
