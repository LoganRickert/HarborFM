import type {
  PublicConfig,
  PublicEpisodesResponse,
  PublicPodcastsListQuery,
  PublicPodcastsResponse,
} from '@harborfm/shared';
import { apiGet, apiPost, apiDelete } from './client';

/** camelCase shape for public podcast (transformed from server snake_case). */
export interface PublicPodcast {
  id: string;
  title: string;
  slug: string;
  description: string;
  language: string;
  authorName: string;
  artworkUrl: string | null;
  artworkUploaded?: boolean;
  artworkFilename?: string | null;
  siteUrl: string | null;
  explicit: number;
  rssUrl?: string | null;
  createdAt?: string;
  subscriberOnlyFeedEnabled?: boolean;
  publicFeedDisabled?: boolean;
  /** When true, only subscribers (signed in with subscriber link) can leave reviews. */
  subscriberOnlyReviews?: boolean;
  /** When true, only subscribers can see/use Message button and submit contact. */
  subscriberOnlyMessages?: boolean;
  canonicalFeedUrl?: string;
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
}

/** camelCase shape for public episode (transformed from server snake_case). */
export interface PublicEpisode {
  id: string;
  podcastId: string;
  title: string;
  slug: string;
  description: string;
  guid: string;
  seasonNumber: number | null;
  episodeNumber: number | null;
  episodeType: string | null;
  explicit: number | null;
  publishAt: string | null;
  artworkUrl: string | null;
  artworkFilename?: string | null;
  audioMime: string | null;
  audioBytes: number | null;
  audioDurationSec: number | null;
  audioUrl: string | null;
  videoUrl?: string | null;
  srtUrl?: string | null;
  subscriberOnly?: boolean;
  createdAt: string;
  updatedAt: string;
  privateAudioUrl?: string | null;
  privateWaveformUrl?: string | null;
  privateVideoUrl?: string | null;
  privateSrtUrl?: string | null;
  markers?: Array<{ time: number; title?: string; color?: string }> | null;
}

function toPublicPodcast(r: Record<string, unknown>): PublicPodcast {
  return {
    id: String(r.id ?? ''),
    title: String(r.title ?? ''),
    slug: String(r.slug ?? ''),
    description: String(r.description ?? ''),
    language: String(r.language ?? 'en'),
    authorName: String(r.author_name ?? ''),
    artworkUrl: r.artwork_url != null ? String(r.artwork_url) : null,
    artworkUploaded: Boolean(r.artwork_uploaded),
    artworkFilename: r.artwork_filename != null ? String(r.artwork_filename) : null,
    siteUrl: r.site_url != null ? String(r.site_url) : null,
    explicit: Number(r.explicit ?? 0),
    rssUrl: r.rss_url != null ? String(r.rss_url) : null,
    createdAt: r.created_at != null ? String(r.created_at) : undefined,
    subscriberOnlyFeedEnabled: r.subscriber_only_feed_enabled === 1 || r.subscriber_only_feed_enabled === true,
    publicFeedDisabled: r.public_feed_disabled === 1 || r.public_feed_disabled === true,
    subscriberOnlyReviews: r.subscriber_only_reviews === 1 || r.subscriber_only_reviews === true,
    subscriberOnlyMessages: r.subscriber_only_messages === 1 || r.subscriber_only_messages === true,
    canonicalFeedUrl: r.canonical_feed_url != null ? String(r.canonical_feed_url) : undefined,
    applePodcastsUrl: r.apple_podcasts_url != null ? String(r.apple_podcasts_url) : null,
    spotifyUrl: r.spotify_url != null ? String(r.spotify_url) : null,
    amazonMusicUrl: r.amazon_music_url != null ? String(r.amazon_music_url) : null,
    podcastIndexUrl: r.podcast_index_url != null ? String(r.podcast_index_url) : null,
    listenNotesUrl: r.listen_notes_url != null ? String(r.listen_notes_url) : null,
    castboxUrl: r.castbox_url != null ? String(r.castbox_url) : null,
    xUrl: r.x_url != null ? String(r.x_url) : null,
    facebookUrl: r.facebook_url != null ? String(r.facebook_url) : null,
    instagramUrl: r.instagram_url != null ? String(r.instagram_url) : null,
    tiktokUrl: r.tiktok_url != null ? String(r.tiktok_url) : null,
    youtubeUrl: r.youtube_url != null ? String(r.youtube_url) : null,
  };
}

function toPublicEpisode(r: Record<string, unknown>): PublicEpisode {
  return {
    id: String(r.id ?? ''),
    podcastId: String(r.podcast_id ?? ''),
    title: String(r.title ?? ''),
    slug: String(r.slug ?? ''),
    description: String(r.description ?? ''),
    guid: String(r.guid ?? ''),
    seasonNumber: r.season_number != null ? Number(r.season_number) : null,
    episodeNumber: r.episode_number != null ? Number(r.episode_number) : null,
    episodeType: r.episode_type != null ? String(r.episode_type) : null,
    explicit: r.explicit != null ? Number(r.explicit) : null,
    publishAt: r.publish_at != null ? String(r.publish_at) : null,
    artworkUrl: r.artwork_url != null ? String(r.artwork_url) : null,
    artworkFilename: r.artwork_filename != null ? String(r.artwork_filename) : null,
    audioMime: r.audio_mime != null ? String(r.audio_mime) : null,
    audioBytes: r.audio_bytes != null ? Number(r.audio_bytes) : null,
    audioDurationSec: r.audio_duration_sec != null ? Number(r.audio_duration_sec) : null,
    audioUrl: r.audio_url != null ? String(r.audio_url) : null,
    videoUrl: (r.video_url as string | null) ?? null,
    srtUrl: r.srt_url != null ? String(r.srt_url) : null,
    subscriberOnly: r.subscriber_only === 1 || r.subscriber_only === true,
    createdAt: String(r.created_at ?? ''),
    updatedAt: String(r.updated_at ?? ''),
    privateAudioUrl: (r.private_audio_url as string | null) ?? null,
    privateWaveformUrl: (r.private_waveform_url as string | null) ?? null,
    privateVideoUrl: (r.private_video_url as string | null) ?? null,
    privateSrtUrl: (r.private_srt_url as string | null) ?? null,
    markers: Array.isArray(r.markers) ? r.markers : [],
  };
}

export type { PublicConfig, PublicEpisodesResponse, PublicPodcastsListQuery, PublicPodcastsResponse };

// PublicEpisode with auth may include private URLs (same shape; server may send null when unauthenticated)
export type PublicEpisodeWithAuth = PublicEpisode;

export function getPublicConfig() {
  return apiGet<PublicConfig>(`/public/config`);
}

export function getPublicPodcasts(params?: PublicPodcastsListQuery) {
  const search = new URLSearchParams();
  if (params?.limit != null) search.set('limit', String(params.limit));
  if (params?.offset != null) search.set('offset', String(params.offset));
  if (params?.q?.trim()) search.set('q', params.q.trim());
  if (params?.sort) search.set('sort', params.sort);
  const query = search.toString();
  return apiGet<PublicPodcastsResponse>(`/public/podcasts${query ? `?${query}` : ''}`).then((data) => ({
    ...data,
    podcasts: (data.podcasts ?? []).map((p) => toPublicPodcast(p as Record<string, unknown>)),
  }));
}

export function getPublicPodcast(slug: string) {
  return apiGet<Record<string, unknown>>(`/public/podcasts/${slug}`).then((r) => toPublicPodcast(r));
}

export function getPublicEpisodes(
  podcastSlug: string,
  limit = 50,
  offset = 0,
  sort: 'newest' | 'oldest' = 'newest',
  q?: string
) {
  const params = new URLSearchParams();
  params.set('limit', String(limit));
  params.set('offset', String(offset));
  params.set('sort', sort);
  if (q?.trim()) params.set('q', q.trim());
  return apiGet<PublicEpisodesResponse>(`/public/podcasts/${podcastSlug}/episodes?${params.toString()}`).then((data) => ({
    ...data,
    episodes: (data.episodes ?? []).map((e) => toPublicEpisode(e as Record<string, unknown>)),
  }));
}

export function getPublicEpisode(podcastSlug: string, episodeSlug: string) {
  return apiGet<Record<string, unknown>>(`/public/podcasts/${podcastSlug}/episodes/${episodeSlug}`).then((r) =>
    toPublicEpisode(r)
  );
}

export interface PublicCastMember {
  id: string;
  name: string;
  role: 'host' | 'guest';
  description: string | null;
  photo_url: string | null;
  social_link_text: string | null;
}

export function getPublicEpisodeCast(podcastSlug: string, episodeSlug: string) {
  return apiGet<{ cast: PublicCastMember[] }>(
    `/public/podcasts/${encodeURIComponent(podcastSlug)}/episodes/${encodeURIComponent(episodeSlug)}/cast`
  );
}

export function getPublicCast(
  podcastSlug: string,
  params?: { limit?: number; offset?: number }
) {
  const search = new URLSearchParams();
  if (params?.limit != null) search.set('limit', String(params.limit));
  if (params?.offset != null) search.set('offset', String(params.offset));
  const query = search.toString();
  return apiGet<{
    hosts: PublicCastMember[];
    guests: PublicCastMember[];
    guests_total: number;
    guests_has_more: boolean;
  }>(`/public/podcasts/${podcastSlug}/cast${query ? `?${query}` : ''}`);
}

export function publicEpisodeWaveformUrl(podcastSlug: string, episodeSlug: string): string {
  return `/api/public/podcasts/${encodeURIComponent(podcastSlug)}/episodes/${encodeURIComponent(episodeSlug)}/waveform`;
}

// Subscriber authentication functions
export function authenticateSubscriber(token: string, podcastSlug: string) {
  return apiPost<{ success: boolean; podcastSlug: string }>('/public/subscriber-auth', { token, podcastSlug });
}

export function getSubscriberAuthStatus() {
  return apiGet<{ authenticated: boolean; podcastSlugs: string[]; tokens: Record<string, string> }>('/public/subscriber-auth/status');
}

export function logoutSubscriber(podcastSlug?: string) {
  const query = podcastSlug ? `?podcastSlug=${encodeURIComponent(podcastSlug)}` : '';
  return apiDelete<{ success: boolean }>(`/public/subscriber-auth${query}`);
}
