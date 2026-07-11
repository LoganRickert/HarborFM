import type { Plugin } from 'vite';
import {
  DEFAULT_OG_IMAGE_PATH,
  injectSpaMetaHtml,
  type SpaPageMeta,
} from '@harborfm/shared';

const API_TARGET = process.env.VITE_SPA_META_API ?? 'http://localhost:3001';
const RESERVED_SINGLE_SEGMENTS = new Set([
  'login',
  'register',
  'setup',
  'feed',
  'embed',
  'api',
  'privacy',
  'terms',
  'contact',
  'verify-email',
  'complete-account',
  'reset-password',
  'call',
  'library',
  'profile',
  'users',
  'messages',
  'settings',
  'dashboard',
  'podcasts',
  'episodes',
]);

type PublicConfig = { whiteLabel?: string; customFeedSlug?: string };
type PublicPodcast = {
  id: string;
  title: string;
  description?: string;
  artwork_url?: string | null;
  artwork_filename?: string | null;
};
type PublicEpisode = {
  id: string;
  podcast_id: string;
  title: string;
  description?: string;
  artwork_url?: string | null;
  artwork_filename?: string | null;
};

function absoluteUrl(origin: string, pathOrUrl: string): string {
  if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) return pathOrUrl;
  return new URL(pathOrUrl, origin).href;
}

function podcastCoverUrl(origin: string, podcast: PublicPodcast): string | null {
  if (podcast.artwork_url) return absoluteUrl(origin, podcast.artwork_url);
  if (podcast.artwork_filename) {
    return absoluteUrl(
      origin,
      `/api/public/artwork/${podcast.id}/${encodeURIComponent(podcast.artwork_filename)}`,
    );
  }
  return null;
}

function episodeCoverUrl(
  origin: string,
  podcastId: string,
  episode: PublicEpisode,
): string | null {
  if (episode.artwork_url) return absoluteUrl(origin, episode.artwork_url);
  if (episode.artwork_filename) {
    return absoluteUrl(
      origin,
      `/api/public/artwork/${podcastId}/episodes/${episode.id}/${encodeURIComponent(episode.artwork_filename)}`,
    );
  }
  return null;
}

async function fetchJson<T>(url: string, host: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: { Host: host } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function resolveFeedRoute(
  pathname: string,
  customFeedSlug?: string,
): { podcastSlug: string; episodeSlug?: string } | null {
  const clean = pathname.split('?')[0].replace(/\/$/, '') || '/';
  const feedMatch = clean.match(/^\/feed\/([^/]+)(?:\/([^/]+))?$/);
  if (feedMatch) {
    return {
      podcastSlug: decodeURIComponent(feedMatch[1]),
      episodeSlug: feedMatch[2] ? decodeURIComponent(feedMatch[2]) : undefined,
    };
  }
  if (!customFeedSlug) return null;
  if (clean === '/' || clean === '') return { podcastSlug: customFeedSlug };
  const segmentMatch = clean.match(/^\/([^/]+)$/);
  if (!segmentMatch) return null;
  const segment = decodeURIComponent(segmentMatch[1]).toLowerCase();
  if (RESERVED_SINGLE_SEGMENTS.has(segment)) return null;
  return {
    podcastSlug: customFeedSlug,
    episodeSlug: decodeURIComponent(segmentMatch[1]),
  };
}

async function resolveSpaMeta(
  pathname: string,
  host: string,
  proto: string,
): Promise<SpaPageMeta | null> {
  const origin = `${proto}://${host}`;
  const config = await fetchJson<PublicConfig>(`${API_TARGET}/api/public/config`, host);
  if (!config) return null;

  const route = resolveFeedRoute(pathname, config.customFeedSlug);
  if (!route) return null;

  const siteName = config.whiteLabel?.trim() || 'HarborFM';
  const defaultImage = absoluteUrl(origin, DEFAULT_OG_IMAGE_PATH);
  const pageUrl = absoluteUrl(origin, pathname);

  const podcast = await fetchJson<PublicPodcast>(
    `${API_TARGET}/api/public/podcasts/${encodeURIComponent(route.podcastSlug)}`,
    host,
  );
  if (!podcast) return null;

  const podcastCover = podcastCoverUrl(origin, podcast) ?? defaultImage;

  if (!route.episodeSlug) {
    return {
      title: `${podcast.title} | ${siteName}`,
      description: (podcast.description ?? '').trim(),
      siteName,
      url: pageUrl,
      image: podcastCover,
    };
  }

  const episode = await fetchJson<PublicEpisode>(
    `${API_TARGET}/api/public/podcasts/${encodeURIComponent(route.podcastSlug)}/episodes/${encodeURIComponent(route.episodeSlug)}`,
    host,
  );
  if (!episode) return null;

  const episodeCover =
    episodeCoverUrl(origin, podcast.id, episode) ?? podcastCover;

  return {
    title: `${episode.title} | ${podcast.title} | ${siteName}`,
    description: (episode.description ?? '').trim() || (podcast.description ?? '').trim(),
    siteName,
    url: pageUrl,
    image: episodeCover,
  };
}

export function spaMetaPlugin(): Plugin {
  return {
    name: 'harborfm-spa-meta',
    transformIndexHtml: {
      order: 'pre',
      async handler(html, ctx) {
        const originalUrl = ctx.originalUrl ?? ctx.path ?? '/';
        const pathname = originalUrl.split('?')[0];
        if (pathname.includes('.') && !pathname.endsWith('.html')) {
          return html;
        }

        const host =
          (ctx.server?.config.server?.host === true
            ? 'localhost'
            : String(ctx.server?.config.server?.host ?? 'localhost')) +
          `:${ctx.server?.config.server?.port ?? 5173}`;
        const proto = 'http';
        const meta = await resolveSpaMeta(pathname, host, proto);
        if (!meta) return html;
        return injectSpaMetaHtml(html, meta);
      },
    },
  };
}
