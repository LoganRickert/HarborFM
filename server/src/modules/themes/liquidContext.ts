import { API_PREFIX } from "../../config.js";
import { readSettings } from "../settings/repo.js";
import * as publicRepo from "../public/repo.js";
import { publicCastDto, publicPodcastDto } from "../public/utils.js";
import {
  getPodcastReviewSettings,
  listPublicReviews,
} from "../reviews/repo.js";
import type { LiquidPodcastContext } from "./render.js";

function asBool(v: unknown, fallback: boolean): boolean {
  if (v === undefined || v === null) return fallback;
  return v === true || v === 1 || v === "1";
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

const PODCAST_LINK_KEYS = [
  "applePodcastsUrl",
  "spotifyUrl",
  "amazonMusicUrl",
  "podcastIndexUrl",
  "listenNotesUrl",
  "castboxUrl",
  "xUrl",
  "facebookUrl",
  "instagramUrl",
  "tiktokUrl",
  "youtubeUrl",
  "discordUrl",
] as const;

function podcastHasLinks(row: Record<string, unknown>): boolean {
  return PODCAST_LINK_KEYS.some((key) => {
    const url = row[key];
    return typeof url === "string" && url.trim().length > 0;
  });
}

export function podcastShowFlags(row: Record<string, unknown>) {
  return {
    author: asBool(row.feedShowAuthor, true),
    podcast_description: asBool(row.feedShowPodcastDescription, true),
    episode_description: asBool(row.feedShowEpisodeDescription, true),
    funding: asBool(row.feedShowFunding, true),
    reviews_podcast: asBool(row.feedShowReviewsPodcast, true),
    reviews_episode: asBool(row.feedShowReviewsEpisode, true),
    podroll: asBool(row.feedShowPodroll, true),
    cast: asBool(row.feedShowCast, true),
    links: podcastHasLinks(row),
  };
}

function podcastArtworkUrl(podcast: {
  id: string;
  artworkUrl?: string | null;
  artworkPath?: string | null;
}): string | null {
  if (podcast.artworkUrl) return podcast.artworkUrl;
  if (podcast.artworkPath) {
    return `/${API_PREFIX}/public/artwork/${podcast.id}/${encodeURIComponent(
      podcast.artworkPath.split(/[/\\]/).pop() || "artwork",
    )}`;
  }
  return null;
}

function mapCastMember(
  row: Parameters<typeof publicCastDto>[0],
  podcastId: string,
) {
  const dto = publicCastDto(row, podcastId);
  return {
    id: String(dto.id),
    name: String(dto.name || ""),
    role: String(dto.role || ""),
    description: dto.description ? stripHtml(String(dto.description)) : "",
    image_url: dto.photo_url ?? "",
    url: dto.social_link_text ? String(dto.social_link_text) : "",
  };
}

function buildEpisodes(podcastId: string) {
  const { rows } = publicRepo.listPublishedEpisodes(podcastId, {
    limit: 50,
    offset: 0,
    sort: "newest",
    searchPattern: null,
    includeSubscriberOnly: false,
    includeScheduledEpisodes: false,
  });
  return rows.map((ep) => ({
    id: ep.id,
    title: String(ep.title || ""),
    description: stripHtml(String(ep.description || "")),
    slug: String(ep.slug || ""),
    publish_at: ep.publishAt ?? null,
    artwork_url: ep.artworkUrl ?? null,
    duration_seconds: ep.audioDurationSec ?? null,
  }));
}

/**
 * Full Liquid context for theme renders: podcast fields, cast, funding, links,
 * podroll, reviews, and episodes (when requested).
 */
export function buildLiquidThemeContext(options: {
  podcast: Record<string, unknown> & {
    id: string;
    title?: string | null;
    description?: string | null;
    authorName?: string | null;
    artworkUrl?: string | null;
    artworkPath?: string | null;
    feedAccent?: string | null;
    fundingLinks?: string | null;
    podroll?: string | null;
  };
  slug: string;
  page: string;
  urls: LiquidPodcastContext["urls"];
  siteName: string;
  includeEpisodes?: boolean;
  episode?: LiquidPodcastContext["episode"];
  reviewsEpisodeId?: string | null;
}): LiquidPodcastContext {
  const { podcast, slug, page, urls, siteName } = options;
  const show = podcastShowFlags(podcast);
  const dto = publicPodcastDto(podcast);

  const podcastFields: Record<string, unknown> = {
    title: String(podcast.title || ""),
    description: stripHtml(String(podcast.description || "")),
    author_name: String(podcast.authorName || ""),
    artwork_url: podcastArtworkUrl(podcast),
    rss_url: `/${API_PREFIX}/public/podcasts/${encodeURIComponent(slug)}/rss`,
    slug,
    apple_podcasts_url: dto.apple_podcasts_url ?? "",
    spotify_url: dto.spotify_url ?? "",
    amazon_music_url: dto.amazon_music_url ?? "",
    podcast_index_url: dto.podcast_index_url ?? "",
    listen_notes_url: dto.listen_notes_url ?? "",
    castbox_url: dto.castbox_url ?? "",
    x_url: dto.x_url ?? "",
    facebook_url: dto.facebook_url ?? "",
    instagram_url: dto.instagram_url ?? "",
    tiktok_url: dto.tiktok_url ?? "",
    youtube_url: dto.youtube_url ?? "",
    discord_url: dto.discord_url ?? "",
  };

  const funding_links =
    show.funding && dto.funding_links
      ? dto.funding_links.map((f) => ({
          url: f.url,
          text: f.text ?? f.url,
        }))
      : [];

  const podroll =
    show.podroll && dto.podroll
      ? dto.podroll.map((p) => ({
          title: p.title ?? "",
          feed_url: p.feed_url ?? "",
          home_url: p.home_url ?? "",
          cover_art_url: p.cover_art_url ?? "",
          feed_guid: p.feed_guid,
        }))
      : [];

  let cast = { hosts: [] as ReturnType<typeof mapCastMember>[], guests: [] as ReturnType<typeof mapCastMember>[] };
  if (show.cast) {
    const hosts = publicRepo.getPodcastCastHosts(podcast.id);
    const { rows: guests } = publicRepo.getPodcastCastGuests(podcast.id, 100, 0);
    cast = {
      hosts: hosts.map((r) => mapCastMember(r, podcast.id)),
      guests: guests.map((r) => mapCastMember(r, podcast.id)),
    };
  }

  const links: Array<{ key: string; label: string; url: string; group: string }> = [];
  if (show.links) {
    const listen: Array<[string, string, string]> = [
      ["apple_podcasts", "Apple Podcasts", String(dto.apple_podcasts_url || "")],
      ["spotify", "Spotify", String(dto.spotify_url || "")],
      ["amazon_music", "Amazon Music", String(dto.amazon_music_url || "")],
      ["podcast_index", "Podcast Index", String(dto.podcast_index_url || "")],
      ["listen_notes", "Listen Notes", String(dto.listen_notes_url || "")],
      ["castbox", "Castbox", String(dto.castbox_url || "")],
    ];
    const social: Array<[string, string, string]> = [
      ["x", "X", String(dto.x_url || "")],
      ["facebook", "Facebook", String(dto.facebook_url || "")],
      ["instagram", "Instagram", String(dto.instagram_url || "")],
      ["tiktok", "TikTok", String(dto.tiktok_url || "")],
      ["youtube", "YouTube", String(dto.youtube_url || "")],
      ["discord", "Discord", String(dto.discord_url || "")],
    ];
    for (const [key, label, url] of listen) {
      if (url.trim()) links.push({ key, label, url: url.trim(), group: "listen" });
    }
    for (const [key, label, url] of social) {
      if (url.trim()) links.push({ key, label, url: url.trim(), group: "social" });
    }
  }

  let reviews: Array<{
    id: string;
    name: string;
    rating: number;
    body: string;
    verified: boolean;
    created_at: string;
    episode_title: string;
  }> = [];
  const wantPodcastReviews =
    show.reviews_podcast && options.reviewsEpisodeId === undefined;
  const wantEpisodeReviews =
    show.reviews_episode && options.reviewsEpisodeId != null;
  if (wantPodcastReviews || wantEpisodeReviews) {
    const settings = readSettings();
    const publishNonVerified =
      (settings as { reviews_publish_non_verified?: boolean }).reviews_publish_non_verified ??
      false;
    const podcastSettings = getPodcastReviewSettings(podcast.id);
    const allowUnapprovedReviews = podcastSettings?.allowUnapprovedReviews ?? true;
    // SSR Liquid loops are not paginated; prefer {% render 'harborfm/reviews' %} for Load more.
    const rows = listPublicReviews({
      podcastId: podcast.id,
      episodeId: wantEpisodeReviews ? options.reviewsEpisodeId! : null,
      limit: 10,
      offset: 0,
      publishNonVerified,
      allowUnapprovedReviews,
    });
    reviews = rows.map((r) => ({
      id: r.id,
      name: String(r.name || ""),
      rating: Number(r.rating) || 0,
      body: stripHtml(String(r.body || "")),
      verified: Boolean(r.verified),
      created_at: String(r.createdAt || ""),
      episode_title: r.episodeTitle ? String(r.episodeTitle) : "",
    }));
  }

  return {
    podcast: {
      ...podcastFields,
      funding_links,
      podroll,
      links,
    },
    cast,
    funding_links,
    links,
    podroll,
    reviews,
    episodes: options.includeEpisodes === false ? undefined : buildEpisodes(podcast.id),
    episode: options.episode,
    accentId: podcast.feedAccent,
    show,
    urls,
    site: { name: siteName },
    page,
  };
}
