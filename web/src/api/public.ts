import type {
  PublicConfig,
  PublicEpisode,
  PublicEpisodesResponse,
  PublicPodcast,
  PublicPodcastsListQuery,
  PublicPodcastsResponse,
} from '@harborfm/shared';
import { apiGet, apiPost, apiDelete } from './client';

export type { PublicConfig, PublicEpisode, PublicEpisodesResponse, PublicPodcast, PublicPodcastsResponse };

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
  return apiGet<PublicPodcastsResponse>(`/public/podcasts${query ? `?${query}` : ''}`);
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
