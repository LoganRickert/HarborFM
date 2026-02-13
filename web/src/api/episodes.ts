import type { EpisodeCreate, EpisodeResponse, EpisodeUpdate, EpisodesResponse } from '@harborfm/shared';
import { apiGet, apiPost, apiPatch, csrfHeaders } from './client';

const BASE = '/api';

export type { EpisodeCreate, EpisodeResponse, EpisodeUpdate, EpisodesResponse };
export type Episode = EpisodeResponse;

export function listEpisodes(podcastId: string) {
  return apiGet<EpisodesResponse>(`/podcasts/${podcastId}/episodes`).then((r) => r.episodes);
}

export function getEpisode(id: string) {
  return apiGet<EpisodeResponse>(`/episodes/${id}`);
}

export function createEpisode(podcastId: string, body: EpisodeCreate) {
  return apiPost<EpisodeResponse>(`/podcasts/${podcastId}/episodes`, body);
}

export function updateEpisode(id: string, body: EpisodeUpdate) {
  return apiPatch<EpisodeResponse>(`/episodes/${id}`, body);
}

export async function uploadEpisodeArtwork(podcastId: string, episodeId: string, file: File): Promise<Episode> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${BASE}/podcasts/${podcastId}/episodes/${episodeId}/artwork`, {
    method: 'POST',
    credentials: 'include',
    headers: csrfHeaders(),
    body: form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? res.statusText);
  }
  return res.json();
}
