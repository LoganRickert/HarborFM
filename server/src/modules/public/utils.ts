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
import { isCurrentlySubscriberOnly } from "../../utils/subscriberOnlyWindow.js";

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

function parseFundingLinks(
  raw: unknown,
): Array<{ url: string; text: string | null }> | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    const items = parsed
      .filter(
        (x): x is Record<string, unknown> =>
          typeof x === "object" && x != null,
      )
      .map((x) => {
        const url = typeof x.url === "string" ? x.url.trim() : "";
        if (!url) return null;
        return {
          url,
          text:
            typeof x.text === "string" && x.text.trim() ? x.text.trim() : null,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x != null);
    return items.length > 0 ? items : null;
  } catch {
    return null;
  }
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
    discordUrl?: string | null;
    podroll?: string | null;
    fundingLinks?: string | null;
  },
) {
  const path = row.artworkPath as string | null | undefined;
  let podroll: Array<{
    feed_guid: string;
    feed_url: string | null;
    title: string | null;
    cover_art_url: string | null;
    home_url: string | null;
  }> | null = null;
  if (typeof row.podroll === "string" && row.podroll.trim()) {
    try {
      const parsed = JSON.parse(row.podroll) as unknown;
      if (Array.isArray(parsed)) {
        const items = parsed
          .filter(
            (x): x is Record<string, unknown> =>
              typeof x === "object" && x != null,
          )
          .map((x) => {
            const feedGuid =
              typeof x.feedGuid === "string" ? x.feedGuid.trim() : "";
            if (!feedGuid) return null;
            return {
              feed_guid: feedGuid,
              feed_url:
                typeof x.feedUrl === "string" && x.feedUrl.trim()
                  ? x.feedUrl.trim()
                  : null,
              title:
                typeof x.title === "string" && x.title.trim()
                  ? x.title.trim()
                  : null,
              cover_art_url:
                typeof x.coverArtUrl === "string" && x.coverArtUrl.trim()
                  ? x.coverArtUrl.trim()
                  : null,
              home_url:
                typeof x.homeUrl === "string" && x.homeUrl.trim()
                  ? x.homeUrl.trim()
                  : null,
            };
          })
          .filter((x): x is NonNullable<typeof x> => x != null);
        if (items.length > 0) podroll = items;
      }
    } catch {
      podroll = null;
    }
  }
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
    subscriber_only_reviews: (row as { subscriberOnlyReviews?: number | boolean | null }).subscriberOnlyReviews ?? 0,
    subscriber_only_messages: (row as { subscriberOnlyMessages?: number | boolean | null }).subscriberOnlyMessages ?? 0,
    show_scheduled_episodes: (row as { showScheduledEpisodes?: number | boolean | null }).showScheduledEpisodes ?? 0,
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
    discord_url: row.discordUrl ?? null,
    podroll,
    funding_links: parseFundingLinks(row.fundingLinks ?? null),
    feed_accent:
      typeof (row as { feedAccent?: unknown }).feedAccent === "string" &&
      String((row as { feedAccent: string }).feedAccent).trim()
        ? String((row as { feedAccent: string }).feedAccent).trim()
        : "green",
    feed_show_podcast_description:
      (row as { feedShowPodcastDescription?: number | boolean | null })
        .feedShowPodcastDescription ?? 1,
    feed_show_episode_description:
      (row as { feedShowEpisodeDescription?: number | boolean | null })
        .feedShowEpisodeDescription ?? 1,
    feed_show_funding:
      (row as { feedShowFunding?: number | boolean | null }).feedShowFunding ?? 1,
    feed_show_reviews_podcast:
      (row as { feedShowReviewsPodcast?: number | boolean | null })
        .feedShowReviewsPodcast ?? 1,
    feed_show_reviews_episode:
      (row as { feedShowReviewsEpisode?: number | boolean | null })
        .feedShowReviewsEpisode ?? 1,
    feed_show_author:
      (row as { feedShowAuthor?: number | boolean | null }).feedShowAuthor ?? 1,
    feed_show_podroll:
      (row as { feedShowPodroll?: number | boolean | null }).feedShowPodroll ?? 1,
    feed_show_cast:
      (row as { feedShowCast?: number | boolean | null }).feedShowCast ?? 1,
    episode_alerts_enabled:
      (row as { episodeAlertsEnabled?: number | boolean | null })
        .episodeAlertsEnabled ?? 0,
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
  const subscriberOnly = isCurrentlySubscriberOnly(row);
  const subscriberOnlyFlagOn =
    row.subscriberOnly === true || row.subscriberOnly === 1;
  const publishAtRaw = row.publishAt;
  const isScheduledNotReleased =
    publishAtRaw != null &&
    typeof publishAtRaw === "string" &&
    new Date(publishAtRaw) > new Date();
  const expiresAtRaw = row.expiresAt;
  const isExpired =
    expiresAtRaw != null &&
    typeof expiresAtRaw === "string" &&
    expiresAtRaw.trim() !== "" &&
    new Date(expiresAtRaw) <= new Date();
  const allowPublicAudio =
    !subscriberOnlyFeed &&
    !subscriberOnly &&
    !isScheduledNotReleased &&
    !isExpired;
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
    hasSrt &&
    !subscriberOnlyFeed &&
    !subscriberOnly &&
    !isScheduledNotReleased &&
    !isExpired;
  const chaptersPath =
    opts.podcastSlug && row.slug
      ? chaptersJsonPath(podcastId, String(row.id))
      : null;
  const hasChapters = chaptersPath && existsSync(chaptersPath);
  const allowPublicChapters =
    hasChapters &&
    !subscriberOnlyFeed &&
    !subscriberOnly &&
    !isScheduledNotReleased &&
    !isExpired;

  const rawMarkers = row.finalMarkers as string | null | undefined;
  let markers: Array<{ time: number; title?: string; color?: string }> = [];
  if (
    !isScheduledNotReleased &&
    !isExpired &&
    rawMarkers != null &&
    typeof rawMarkers === "string" &&
    rawMarkers.trim()
  ) {
    try {
      const parsed = JSON.parse(rawMarkers) as unknown;
      if (Array.isArray(parsed)) {
        markers = parsed.filter(
          (m): m is { time: number; title?: string; color?: string } =>
            typeof m === "object" && m != null && typeof (m as { time?: number }).time === "number"
        );
      }
    } catch {
      /* leave markers as [] */
    }
  }

  const rawSoundbites = row.finalSoundbites as string | null | undefined;
  let soundbites: Array<{ time: number; duration: number; title?: string; color?: string }> = [];
  if (
    !isScheduledNotReleased &&
    !isExpired &&
    rawSoundbites != null &&
    typeof rawSoundbites === "string" &&
    rawSoundbites.trim()
  ) {
    try {
      const parsed = JSON.parse(rawSoundbites) as unknown;
      if (Array.isArray(parsed)) {
        soundbites = parsed.filter(
          (m): m is { time: number; duration: number; title?: string; color?: string } =>
            typeof m === "object" &&
            m != null &&
            typeof (m as { time?: number }).time === "number" &&
            typeof (m as { duration?: number }).duration === "number" &&
            (m as { duration: number }).duration >= 15 &&
            (m as { duration: number }).duration <= 120,
        );
      }
    } catch {
      /* leave soundbites as [] */
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
    // Only expose window dates when the toggle is on (ignored for gating when off).
    subscriber_only_starts_at: subscriberOnlyFlagOn
      ? (row.subscriberOnlyStartsAt ?? null)
      : null,
    subscriber_only_ends_at: subscriberOnlyFlagOn
      ? (row.subscriberOnlyEndsAt ?? null)
      : null,
    scheduled_not_released: isScheduledNotReleased ? 1 : 0,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    markers,
    soundbites,
    funding_links: parseFundingLinks(row.fundingLinks ?? null),
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
