import type { EpisodeCreate, EpisodeResponse, EpisodeUpdate, EpisodesResponse } from '@harborfm/shared';
import { apiDelete, apiGet, apiPatch, apiPost, apiPut, csrfHeaders } from './client';

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

export function deleteEpisode(id: string) {
  return apiDelete<void>(`/episodes/${id}`);
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

export type ImportProjectResult = {
  episodeId: string;
  slug: string;
  episode?: Episode;
};

/** Upload a HarborFM project zip; recreates a draft episode on the show (managers and the owner). */
export async function importEpisodeProject(
  podcastId: string,
  file: File,
): Promise<ImportProjectResult> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${BASE}/podcasts/${podcastId}/episodes/import-project`, {
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

// Episode cast (assign hosts/guests to episode)
export interface EpisodeCastMember {
  id: string;
  podcastId: string;
  name: string;
  role: 'host' | 'guest';
  description: string | null;
  photoPath: string | null;
  photoUrl: string | null;
  photoFilename?: string | null;
  socialLinkText: string | null;
  isPublic: boolean;
  createdAt: string;
}

export function getEpisodeCast(podcastId: string, episodeId: string) {
  return apiGet<{ cast: EpisodeCastMember[] }>(`/podcasts/${podcastId}/episodes/${episodeId}/cast`);
}

export function assignEpisodeCast(podcastId: string, episodeId: string, castIds: string[]) {
  return apiPut<{ cast: EpisodeCastMember[] }>(`/podcasts/${podcastId}/episodes/${episodeId}/cast`, {
    castIds,
  });
}
