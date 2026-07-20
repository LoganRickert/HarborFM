import type { FastifyRequest } from "fastify";
import {
  DEFAULT_OG_IMAGE_PATH,
  type SpaPageMeta,
} from "@harborfm/shared";
import { APP_NAME, API_PREFIX } from "../config.js";
import { readSettings } from "../modules/settings/index.js";
import * as repo from "../modules/public/repo.js";
import { publicEpisodeDto, publicPodcastDto } from "../modules/public/utils.js";
import { getPodcastByHost } from "./dns/custom-domain-resolver.js";
import { getSessionForJoinInfo } from "./callSession.js";
import {
  getPodcastForJoinInfo,
  getEpisodeForJoinInfo,
} from "../modules/call/repo.js";

const RESERVED_SINGLE_SEGMENTS = new Set([
  "login",
  "register",
  "setup",
  "feed",
  "embed",
  "api",
  "privacy",
  "terms",
  "contact",
  "verify-email",
  "complete-account",
  "reset-password",
  "call",
  "library",
  "profile",
  "users",
  "messages",
  "settings",
  "dashboard",
  "podcasts",
  "episodes",
]);

function requestHost(request: FastifyRequest): string {
  const forwarded = request.headers["x-forwarded-host"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim().split(":")[0];
  }
  const hostHeader = request.headers.host;
  if (typeof hostHeader === "string" && hostHeader.trim()) {
    return hostHeader.split(",")[0].trim().split(":")[0];
  }
  return (request.hostname ?? "").split(":")[0];
}

function getSiteName(): string {
  const settings = readSettings();
  const whiteLabel = String(
    (settings as { white_label?: string }).white_label ?? "",
  ).trim();
  return whiteLabel || APP_NAME;
}

function requestOrigin(request: FastifyRequest): string {
  const protoHeader = request.headers["x-forwarded-proto"];
  const proto =
    (typeof protoHeader === "string"
      ? protoHeader.split(",")[0]
      : request.protocol) ?? "http";
  const hostHeader =
    request.headers["x-forwarded-host"] ??
    request.headers.host ??
    request.hostname;
  const host =
    (typeof hostHeader === "string"
      ? hostHeader.split(",")[0]
      : request.hostname) ?? request.hostname;
  return `${proto}://${host}`;
}

function absoluteUrl(origin: string, pathOrUrl: string): string {
  if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) {
    return pathOrUrl;
  }
  return new URL(pathOrUrl, origin).href;
}

function podcastCoverUrl(
  origin: string,
  dto: Record<string, unknown>,
): string | null {
  if (dto.artwork_url) {
    return absoluteUrl(origin, String(dto.artwork_url));
  }
  if (dto.artwork_filename && dto.id) {
    return absoluteUrl(
      origin,
      `/${API_PREFIX}/public/artwork/${String(dto.id)}/${encodeURIComponent(String(dto.artwork_filename))}`,
    );
  }
  return null;
}

function episodeCoverUrl(
  origin: string,
  podcastId: string,
  dto: Record<string, unknown>,
): string | null {
  if (dto.artwork_url) {
    return absoluteUrl(origin, String(dto.artwork_url));
  }
  if (dto.artwork_filename && dto.id) {
    return absoluteUrl(
      origin,
      `/${API_PREFIX}/public/artwork/${podcastId}/episodes/${String(dto.id)}/${encodeURIComponent(String(dto.artwork_filename))}`,
    );
  }
  return null;
}

function joinInfoCoverUrl(
  origin: string,
  podcastId: string,
  podcast: {
    artworkPath: string | null;
    artworkUrl: string | null;
  },
  episode: {
    id: string;
    artworkPath: string | null;
    artworkUrl: string | null;
  },
): string | null {
  if (episode.artworkUrl) return absoluteUrl(origin, episode.artworkUrl);
  if (episode.artworkPath) {
    const fn = episode.artworkPath.split(/[/\\]/).pop();
    if (fn) {
      return absoluteUrl(
        origin,
        `/${API_PREFIX}/public/artwork/${podcastId}/episodes/${episode.id}/${encodeURIComponent(fn)}`,
      );
    }
  }
  if (podcast.artworkUrl) return absoluteUrl(origin, podcast.artworkUrl);
  if (podcast.artworkPath) {
    const fn = podcast.artworkPath.split(/[/\\]/).pop();
    if (fn) {
      return absoluteUrl(
        origin,
        `/${API_PREFIX}/public/artwork/${podcastId}/${encodeURIComponent(fn)}`,
      );
    }
  }
  return null;
}

function resolveCallJoinToken(pathname: string): string | null {
  const clean = pathname.split("?")[0].replace(/\/$/, "") || "/";
  const match = clean.match(/^\/call\/join\/([^/]+)$/);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function resolveCallJoinMeta(request: FastifyRequest): SpaPageMeta | null {
  const pathname = request.url.split("?")[0];
  const token = resolveCallJoinToken(pathname);
  if (!token) return null;

  const session = getSessionForJoinInfo(token);
  if (!session) return null;

  const podcast = getPodcastForJoinInfo(session.podcastId);
  const episode = getEpisodeForJoinInfo(session.episodeId, session.podcastId);
  if (!podcast || !episode) return null;

  const origin = requestOrigin(request);
  const siteName = getSiteName();
  const defaultImage = absoluteUrl(origin, DEFAULT_OG_IMAGE_PATH);
  const pageUrl = absoluteUrl(origin, pathname);
  const image =
    joinInfoCoverUrl(origin, session.podcastId, podcast, episode) ??
    defaultImage;

  return {
    title: `${episode.title} | Join Call | ${siteName}`,
    description: `Join the group call for ${episode.title} on ${podcast.title}.`,
    siteName,
    url: pageUrl,
    image,
  };
}

function isThemePageSegment(segment: string | undefined): boolean {
  if (!segment) return false;
  return /^[a-z0-9][a-z0-9_-]*\.html$/i.test(segment);
}

function resolveFeedRoute(
  pathname: string,
  host: string,
): { podcastSlug: string; episodeSlug?: string; themePage?: string } | null {
  const clean = pathname.split("?")[0].replace(/\/$/, "") || "/";

  const feedMatch = clean.match(/^\/feed\/([^/]+)(?:\/([^/]+))?$/);
  if (feedMatch) {
    const second = feedMatch[2] ? decodeURIComponent(feedMatch[2]) : undefined;
    if (second && isThemePageSegment(second)) {
      return {
        podcastSlug: decodeURIComponent(feedMatch[1]),
        themePage: second.toLowerCase(),
      };
    }
    return {
      podcastSlug: decodeURIComponent(feedMatch[1]),
      episodeSlug: second,
    };
  }

  const hostMatch = getPodcastByHost(host);
  if (!hostMatch) return null;

  if (clean === "/" || clean === "") {
    return { podcastSlug: hostMatch.slug };
  }

  const segmentMatch = clean.match(/^\/([^/]+)$/);
  if (!segmentMatch) return null;
  const segmentRaw = decodeURIComponent(segmentMatch[1]);
  const segment = segmentRaw.toLowerCase();
  if (RESERVED_SINGLE_SEGMENTS.has(segment)) return null;
  if (isThemePageSegment(segment)) {
    return { podcastSlug: hostMatch.slug, themePage: segment };
  }

  return {
    podcastSlug: hostMatch.slug,
    episodeSlug: segmentRaw,
  };
}

export function resolveSpaMetaForRequest(
  request: FastifyRequest,
): SpaPageMeta | null {
  const callJoinMeta = resolveCallJoinMeta(request);
  if (callJoinMeta) return callJoinMeta;

  if (!readSettings().public_feeds_enabled) return null;

  const pathname = request.url.split("?")[0];
  const host = requestHost(request);
  const route = resolveFeedRoute(pathname, host);
  if (!route) return null;

  const origin = requestOrigin(request);
  const siteName = getSiteName();
  const defaultImage = absoluteUrl(origin, DEFAULT_OG_IMAGE_PATH);
  const pageUrl = absoluteUrl(origin, pathname);

  const podcastRow = repo.getPodcastBySlug(route.podcastSlug);
  if (!podcastRow) return null;
  if (
    podcastRow.publicFeedDisabled === 1 &&
    podcastRow.subscriberOnlyFeedEnabled !== 1
  ) {
    return null;
  }

  const podcastDto = publicPodcastDto(podcastRow) as Record<string, unknown>;
  const podcastCover = podcastCoverUrl(origin, podcastDto) ?? defaultImage;

  // Home and theme .html pages share podcast-level meta.
  if (!route.episodeSlug || route.themePage) {
    return {
      title: `${String(podcastRow.title)} | ${siteName}`,
      description: String(podcastRow.description ?? "").trim(),
      siteName,
      url: pageUrl,
      image: podcastCover,
    };
  }

  const podcastMeta = repo.getPodcastMetaForFeed(route.podcastSlug);
  if (!podcastMeta) return null;

  const episodeRow = repo.getPublicEpisodeBySlug(
    podcastMeta.id,
    route.episodeSlug,
    podcastMeta.showScheduledEpisodes === 1,
  );
  if (!episodeRow) return null;

  const episodeDto = publicEpisodeDto(podcastMeta.id, episodeRow, {
    podcastSlug: route.podcastSlug,
  }) as Record<string, unknown>;
  const episodeCover =
    episodeCoverUrl(origin, podcastMeta.id, episodeDto) ??
    podcastCoverUrl(origin, podcastDto) ??
    defaultImage;
  const description =
    String(episodeDto.description ?? "").trim() ||
    String(podcastRow.description ?? "").trim();

  return {
    title: `${String(episodeRow.title)} | ${String(podcastRow.title)} | ${siteName}`,
    description,
    siteName,
    url: pageUrl,
    image: episodeCover,
  };
}
