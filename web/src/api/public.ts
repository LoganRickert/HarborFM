import { apiGet } from './client';

export interface PublicPodcast {
  id: string;
  title: string;
  slug: string;
  description: string;
  language: string;
  author_name: string;
  artwork_url: string | null;
  artwork_uploaded?: boolean;
  artwork_filename?: string | null;
  site_url: string | null;
  explicit: number;
  rss_url?: string | null;
}

export interface PublicEpisode {
  id: string;
  podcast_id: string;
  title: string;
  slug: string;
  description: string;
  guid: string;
  season_number: number | null;
  episode_number: number | null;
  episode_type: string | null;
  explicit: number | null;
  publish_at: string | null;
  artwork_url: string | null;
  artwork_filename?: string | null;
  audio_mime: string | null;
  audio_bytes: number | null;
  audio_duration_sec: number | null;
  audio_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface PublicEpisodesResponse {
  episodes: PublicEpisode[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export function getPublicConfig() {
  return apiGet<{ public_feeds_enabled: boolean }>(`/public/config`);
}

export function getPublicPodcast(slug: string) {
  return apiGet<PublicPodcast>(`/public/podcasts/${slug}`);
}

export function getPublicEpisodes(podcastSlug: string, limit = 50, offset = 0) {
  const params = new URLSearchParams();
  params.set('limit', String(limit));
  params.set('offset', String(offset));
  return apiGet<PublicEpisodesResponse>(`/public/podcasts/${podcastSlug}/episodes?${params.toString()}`);
}

export function getPublicEpisode(podcastSlug: string, episodeSlug: string) {
  return apiGet<PublicEpisode>(`/public/podcasts/${podcastSlug}/episodes/${episodeSlug}`);
}

export function publicEpisodeWaveformUrl(podcastSlug: string, episodeSlug: string): string {
  return `/api/public/podcasts/${encodeURIComponent(podcastSlug)}/episodes/${encodeURIComponent(episodeSlug)}/waveform`;
}
