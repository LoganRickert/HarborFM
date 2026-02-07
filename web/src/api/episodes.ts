import { apiGet, apiPost, apiPatch } from './client';

export interface Episode {
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
  status: string;
  artwork_path: string | null;
  artwork_url: string | null;
  audio_source_path: string | null;
  audio_final_path: string | null;
  audio_mime: string | null;
  audio_bytes: number | null;
  audio_duration_sec: number | null;
  episode_link: string | null;
  guid_is_permalink: number;
  created_at: string;
  updated_at: string;
}

export interface EpisodesResponse {
  episodes: Episode[];
}

export function listEpisodes(podcastId: string) {
  return apiGet<EpisodesResponse>(`/podcasts/${podcastId}/episodes`).then((r) => r.episodes);
}

export function getEpisode(id: string) {
  return apiGet<Episode>(`/episodes/${id}`);
}

export function createEpisode(podcastId: string, body: {
  title: string;
  description?: string;
  season_number?: number | null;
  episode_number?: number | null;
  episode_type?: 'full' | 'trailer' | 'bonus' | null;
  explicit?: number | null;
  publish_at?: string | null;
  status?: string;
}) {
  return apiPost<Episode>(`/podcasts/${podcastId}/episodes`, body);
}

export function updateEpisode(id: string, body: Partial<{
  title: string;
  slug: string;
  description: string;
  season_number: number | null;
  episode_number: number | null;
  episode_type: string | null;
  explicit: number | null;
  publish_at: string | null;
  status: string;
  artwork_url: string | null;
  episode_link: string | null;
  guid_is_permalink: number;
}>) {
  return apiPatch<Episode>(`/episodes/${id}`, body);
}
