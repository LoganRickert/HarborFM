import type {
  EpisodeFileItem,
  EpisodeFilesCreateLinkBody,
  EpisodeFilesListResponse,
  EpisodeFilesUpdateBody,
} from '@harborfm/shared';
import { csrfHeaders } from './client';

const BASE = '/api';

export const episodeFilesQueryKey = (episodeId: string) =>
  ['episode-files', episodeId] as const;

export type { EpisodeFileItem };

async function parseError(r: Response): Promise<never> {
  let message = r.statusText || 'Request failed';
  try {
    const err = (await r.json()) as { error?: string };
    if (err?.error) message = err.error;
  } catch {
    /* non-JSON error body */
  }
  throw new Error(message);
}

export function getEpisodeFiles(episodeId: string): Promise<EpisodeFilesListResponse> {
  return fetch(`${BASE}/episodes/${episodeId}/files`, {
    method: 'GET',
    credentials: 'include',
  }).then((r) => {
    if (!r.ok) return parseError(r);
    return r.json();
  });
}

export function uploadEpisodeFile(
  episodeId: string,
  file: File,
  fields: { title?: string; description?: string },
): Promise<EpisodeFileItem> {
  const form = new FormData();
  form.append('file', file);
  if (fields.title?.trim()) form.append('title', fields.title.trim());
  if (fields.description?.trim()) form.append('description', fields.description.trim());
  return fetch(`${BASE}/episodes/${episodeId}/files/upload`, {
    method: 'POST',
    credentials: 'include',
    headers: { ...csrfHeaders() },
    body: form,
  }).then((r) => {
    if (!r.ok) return parseError(r);
    return r.json();
  });
}

export function createEpisodeFileLink(
  episodeId: string,
  body: EpisodeFilesCreateLinkBody,
): Promise<EpisodeFileItem> {
  return fetch(`${BASE}/episodes/${episodeId}/files/link`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
    body: JSON.stringify(body),
  }).then((r) => {
    if (!r.ok) return parseError(r);
    return r.json();
  });
}

export function updateEpisodeFile(
  episodeId: string,
  fileId: string,
  body: EpisodeFilesUpdateBody,
): Promise<EpisodeFileItem> {
  return fetch(`${BASE}/episodes/${episodeId}/files/${fileId}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
    body: JSON.stringify(body),
  }).then((r) => {
    if (!r.ok) return parseError(r);
    return r.json();
  });
}

export function reorderEpisodeFiles(
  episodeId: string,
  itemIds: string[],
): Promise<EpisodeFilesListResponse> {
  return fetch(`${BASE}/episodes/${episodeId}/files/reorder`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
    body: JSON.stringify({ itemIds }),
  }).then((r) => {
    if (!r.ok) return parseError(r);
    return r.json();
  });
}

export function deleteEpisodeFile(episodeId: string, fileId: string): Promise<void> {
  return fetch(`${BASE}/episodes/${episodeId}/files/${fileId}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: { ...csrfHeaders() },
  }).then((r) => {
    if (!r.ok) return parseError(r);
  });
}
