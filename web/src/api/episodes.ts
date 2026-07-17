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

export type ProjectImportStatusResponse = {
  status: 'idle' | 'importing' | 'done' | 'failed';
  episodeId?: string;
  slug?: string;
  error?: string;
};

/** Start episode project import (202). Poll getProjectImportStatus until done/failed. */
export async function startImportEpisodeProject(
  podcastId: string,
  file: File,
): Promise<void> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${BASE}/podcasts/${podcastId}/episodes/import-project`, {
    method: 'POST',
    credentials: 'include',
    headers: csrfHeaders(),
    body: form,
  });
  if (res.status === 202 || res.status === 409) return;
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? res.statusText);
  }
}

export function getProjectImportStatus(
  podcastId: string,
): Promise<ProjectImportStatusResponse> {
  return fetch(`${BASE}/podcasts/${podcastId}/episodes/import-project/status`, {
    credentials: 'include',
  }).then((r) => {
    if (!r.ok) {
      return r.json().then((err: { error?: string }) => {
        throw new Error(err.error ?? r.statusText);
      });
    }
    return r.json();
  });
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
