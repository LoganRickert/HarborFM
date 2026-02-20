import { existsSync } from "fs";
import { basename } from "path";
import { readSettings } from "../settings/index.js";
import {
  assertPathUnder,
  castPhotoDir,
  chaptersJsonPath,
  resolveDataPath,
  transcriptSrtPath,
} from "../../services/paths.js";
import { getCookieSecureFlag } from "../../services/cookies.js";
import { API_PREFIX } from "../../config.js";

export function ensurePublicFeedsEnabled(
  reply: import("fastify").FastifyReply,
): boolean {
  const settings = readSettings();
  if (!settings.public_feeds_enabled) {
    reply.status(404).send({ error: "Not found" });
    return false;
  }
  return true;
}

export function publicPodcastDto(
  row: Record<string, unknown> & {
    artworkPath?: string | null;
    authorName?: string | null;
    artworkUrl?: string | null;
    siteUrl?: string | null;
    subscriberOnlyFeedEnabled?: number | boolean | null;
    publicFeedDisabled?: number | boolean | null;
    applePodcastsUrl?: string | null;
    spotifyUrl?: string | null;
    amazonMusicUrl?: string | null;
    podcastIndexUrl?: string | null;
    listenNotesUrl?: string | null;
    castboxUrl?: string | null;
    xUrl?: string | null;
    facebookUrl?: string | null;
    instagramUrl?: string | null;
    tiktokUrl?: string | null;
    youtubeUrl?: string | null;
  },
) {
  const path = row.artworkPath as string | null | undefined;
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    description: row.description ?? "",
    language: row.language ?? "en",
    author_name: row.authorName ?? "",
    artwork_url: row.artworkUrl ?? null,
    artwork_uploaded: Boolean(path),
    artwork_filename: path ? basename(path) : null,
    site_url: row.siteUrl ?? null,
    explicit: row.explicit ?? 0,
    subscriber_only_feed_enabled: row.subscriberOnlyFeedEnabled ?? 0,
    public_feed_disabled: row.publicFeedDisabled ?? 0,
    apple_podcasts_url: row.applePodcastsUrl ?? null,
    spotify_url: row.spotifyUrl ?? null,
    amazon_music_url: row.amazonMusicUrl ?? null,
    podcast_index_url: row.podcastIndexUrl ?? null,
    listen_notes_url: row.listenNotesUrl ?? null,
    castbox_url: row.castboxUrl ?? null,
    x_url: row.xUrl ?? null,
    facebook_url: row.facebookUrl ?? null,
    instagram_url: row.instagramUrl ?? null,
    tiktok_url: row.tiktokUrl ?? null,
    youtube_url: row.youtubeUrl ?? null,
  };
}

export function publicEpisodeDto(
  podcastId: string,
  row: Record<string, unknown>,
  opts: { subscriberOnlyFeed?: boolean; podcastSlug?: string } = {},
) {
  const subscriberOnlyFeed = opts.subscriberOnlyFeed ?? false;
  const audioBytes =
    row.audioBytes != null ? Number(row.audioBytes) : null;
  const hasAudio =
    Boolean(row.audioFinalPath) && (audioBytes == null || audioBytes > 0);
  const hasVideo = Boolean(row.videoFinalPath);
  const subscriberOnly =
    row.subscriberOnly === 1 || row.subscriberOnly === true;
  const allowPublicAudio = !subscriberOnlyFeed && !subscriberOnly;
  const path = row.artworkPath as string | null | undefined;
  const baseDesc = String(row.description ?? "");
  const snapshotVal = row.descriptionCopyrightSnapshot;
  const snapshot =
    snapshotVal != null ? String(snapshotVal).trim() : "";
  const description = snapshot
    ? `${baseDesc}\r\n\r\nMusic:\r\n${snapshot}`
    : baseDesc;

  const srtPath =
    opts.podcastSlug && row.slug
      ? transcriptSrtPath(podcastId, String(row.id))
      : null;
  const hasSrt = srtPath && existsSync(srtPath);
  const allowPublicSrt =
    hasSrt && !subscriberOnlyFeed && !subscriberOnly;
  const chaptersPath =
    opts.podcastSlug && row.slug
      ? chaptersJsonPath(podcastId, String(row.id))
      : null;
  const hasChapters = chaptersPath && existsSync(chaptersPath);
  const allowPublicChapters =
    hasChapters && !subscriberOnlyFeed && !subscriberOnly;

  const rawMarkers = row.finalMarkers as string | null | undefined;
  let markers: Array<{ time: number; title?: string; color?: string }> | null = null;
  if (rawMarkers != null && typeof rawMarkers === "string" && rawMarkers.trim()) {
    try {
      markers = JSON.parse(rawMarkers) as Array<{ time: number; title?: string; color?: string }>;
    } catch {
      markers = null;
    }
  }

  return {
    id: row.id,
    podcast_id: row.podcastId,
    title: row.title,
    slug: row.slug,
    description,
    guid: row.guid,
    season_number: row.seasonNumber ?? null,
    episode_number: row.episodeNumber ?? null,
    episode_type: row.episodeType ?? null,
    explicit: row.explicit ?? null,
    publish_at: row.publishAt ?? null,
    artwork_url: row.artworkUrl ?? null,
    artwork_filename: path ? basename(path) : null,
    audio_mime: row.audioMime ?? null,
    audio_bytes: audioBytes,
    audio_duration_sec: row.audioDurationSec ?? null,
    audio_url:
      hasAudio && allowPublicAudio
        ? `/${API_PREFIX}/${podcastId}/episodes/${String(row.id)}`
        : null,
    video_url:
      hasVideo && allowPublicAudio
        ? `/${API_PREFIX}/${podcastId}/episodes/${String(row.id)}/video`
        : null,
    srt_url:
      opts.podcastSlug && allowPublicSrt
        ? `/${API_PREFIX}/public/podcasts/${encodeURIComponent(opts.podcastSlug)}/episodes/${encodeURIComponent(String(row.slug))}/transcript.srt`
        : null,
    chapters_url:
      opts.podcastSlug && allowPublicChapters
        ? `/${API_PREFIX}/public/podcasts/${encodeURIComponent(opts.podcastSlug)}/episodes/${encodeURIComponent(String(row.slug))}/chapters.json`
        : null,
    subscriber_only: subscriberOnly ? 1 : 0,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    markers,
  };
}

export function publicCastDto(
  row: Record<string, unknown> & {
    id: string;
    photoPath?: string | null;
    photoUrl?: string | null;
    socialLinkText?: string | null;
  },
  podcastId: string,
) {
  const path = row.photoPath as string | null | undefined;
  let photo_url = row.photoUrl as string | null | undefined;
  if (path && typeof path === "string") {
    try {
      const dir = castPhotoDir(podcastId);
      const resolved = resolveDataPath(path);
      assertPathUnder(resolved, dir);
      const fn = basename(path);
      photo_url = `/${API_PREFIX}/public/artwork/${podcastId}/cast/${row.id}/${fn}`;
    } catch {
      photo_url = row.photoUrl as string | null;
    }
  }
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    description: row.description ?? null,
    photo_url: photo_url ?? null,
    social_link_text: row.socialLinkText ?? null,
  };
}

export const ARTWORK_FILENAME_REGEX = /^[a-zA-Z0-9_-]+\.(png|webp|jpg)$/i;

export function likeEscape(s: string): string {
  return s.replace(/%/g, "\\%").replace(/_/g, "\\_");
}

export const SUBSCRIBER_TOKENS_COOKIE = "subscriber_tokens";
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days
export const AUTH_SUBSCRIBER_TOKEN_CONTEXT = "auth_subscriber_token" as const;

export function getSubscriberCookieSecure(): boolean {
  return getCookieSecureFlag();
}
