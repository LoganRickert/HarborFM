import type { LibraryUpdate } from '@harborfm/shared';
import { csrfHeaders } from './client';

const BASE = '/api';

/** camelCase shape for library assets (API responses mapped from server snake_case). */
export interface LibraryAsset {
  id: string;
  ownerUserId?: string;
  name: string;
  tag: string | null;
  durationSec: number;
  createdAt: string;
  globalAsset?: number | boolean;
  copyright?: string | null;
  license?: string | null;
}

function toLibraryAsset(r: Record<string, unknown>): LibraryAsset {
  const durationSec = r.durationSec ?? r.duration_sec;
  const createdAt = r.createdAt ?? r.created_at;
  const ownerUserId = r.ownerUserId ?? r.owner_user_id;
  const globalAsset = r.globalAsset ?? r.global_asset;
  return {
    id: String(r.id ?? ''),
    ownerUserId: ownerUserId != null ? String(ownerUserId) : undefined,
    name: String(r.name ?? ''),
    tag: r.tag != null ? String(r.tag) : null,
    durationSec: Number(durationSec ?? 0),
    createdAt: String(createdAt ?? ''),
    globalAsset: globalAsset as number | boolean | undefined,
    copyright: r.copyright != null ? String(r.copyright) : null,
    license: r.license != null ? String(r.license) : null,
  };
}

export type { LibraryUpdate };

export function listLibrary(): Promise<{ assets: LibraryAsset[] }> {
  return fetch(`${BASE}/library`, { method: 'GET', credentials: 'include' }).then((r) => {
    if (!r.ok) return r.json().then((err: { error?: string }) => { throw new Error(err.error ?? r.statusText); });
    return r.json().then((data: { assets: Record<string, unknown>[] }) => ({
      assets: (data.assets ?? []).map(toLibraryAsset),
    }));
  });
}

export function listLibraryForUser(userId: string): Promise<{ assets: LibraryAsset[] }> {
  return fetch(`${BASE}/library/user/${userId}`, { method: 'GET', credentials: 'include' }).then((r) => {
    if (!r.ok) return r.json().then((err: { error?: string }) => { throw new Error(err.error ?? r.statusText); });
    return r.json().then((data: { assets: Record<string, unknown>[] }) => ({
      assets: (data.assets ?? []).map(toLibraryAsset),
    }));
  });
}

export function importFromPixabay(url: string): Promise<LibraryAsset> {
  return fetch(`${BASE}/library/import-pixabay`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
    body: JSON.stringify({ url }),
  }).then((r) => {
    if (!r.ok) return r.json().then((err: { error?: string }) => { throw new Error(err.error ?? r.statusText); });
    return r.json().then((data: Record<string, unknown>) => toLibraryAsset(data));
  });
}

export function createLibraryAsset(
  file: File,
  name: string,
  tag?: string | null,
  copyright?: string | null,
  license?: string | null
): Promise<LibraryAsset> {
  const form = new FormData();
  form.append('name', name);
  if (tag) form.append('tag', tag);
  if (copyright) form.append('copyright', copyright);
  if (license) form.append('license', license);
  form.append('file', file);
  const res = fetch(`${BASE}/library`, {
    method: 'POST',
    credentials: 'include',
    headers: csrfHeaders(),
    body: form,
  });
  return res.then((r) => {
    if (!r.ok) return r.json().then((err: { error?: string }) => { throw new Error(err.error ?? r.statusText); });
    return r.json().then((data: Record<string, unknown>) => toLibraryAsset(data));
  });
}

export function updateLibraryAsset(id: string, data: LibraryUpdate): Promise<LibraryAsset> {
  return fetch(`${BASE}/library/${id}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
    body: JSON.stringify(data),
  }).then((r) => {
    if (!r.ok) return r.json().then((err: { error?: string }) => { throw new Error(err.error ?? r.statusText); });
    return r.json().then((data: Record<string, unknown>) => toLibraryAsset(data));
  });
}

export function updateLibraryAssetForUser(userId: string, id: string, data: LibraryUpdate): Promise<LibraryAsset> {
  return fetch(`${BASE}/library/user/${userId}/${id}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
    body: JSON.stringify(data),
  }).then((r) => {
    if (!r.ok) return r.json().then((err: { error?: string }) => { throw new Error(err.error ?? r.statusText); });
    return r.json().then((data: Record<string, unknown>) => toLibraryAsset(data));
  });
}

export function replaceLibraryAssetAudio(id: string, file: File): Promise<LibraryAsset> {
  const form = new FormData();
  form.append('file', file);
  return fetch(`${BASE}/library/${id}/audio`, {
    method: 'PUT',
    credentials: 'include',
    headers: csrfHeaders(),
    body: form,
  }).then((r) => {
    if (!r.ok) return r.json().then((err: { error?: string }) => { throw new Error(err.error ?? r.statusText); });
    return r.json().then((data: Record<string, unknown>) => toLibraryAsset(data));
  });
}

export function replaceLibraryAssetAudioForUser(userId: string, id: string, file: File): Promise<LibraryAsset> {
  const form = new FormData();
  form.append('file', file);
  return fetch(`${BASE}/library/user/${userId}/${id}/audio`, {
    method: 'PUT',
    credentials: 'include',
    headers: csrfHeaders(),
    body: form,
  }).then((r) => {
    if (!r.ok) return r.json().then((err: { error?: string }) => { throw new Error(err.error ?? r.statusText); });
    return r.json().then((data: Record<string, unknown>) => toLibraryAsset(data));
  });
}

export function deleteLibraryAsset(id: string): Promise<void> {
  return fetch(`${BASE}/library/${id}`, { method: 'DELETE', credentials: 'include', headers: csrfHeaders() }).then((r) => {
    if (!r.ok) return r.json().then((err: { error?: string }) => { throw new Error(err.error ?? r.statusText); });
  });
}

export function deleteLibraryAssetForUser(userId: string, id: string): Promise<void> {
  return fetch(`${BASE}/library/user/${userId}/${id}`, { method: 'DELETE', credentials: 'include', headers: csrfHeaders() }).then((r) => {
    if (!r.ok) return r.json().then((err: { error?: string }) => { throw new Error(err.error ?? r.statusText); });
  });
}

export function libraryStreamUrl(id: string): string {
  return `${BASE}/library/${id}/stream`;
}

export function libraryStreamUrlForUser(userId: string, id: string): string {
  return `${BASE}/library/user/${userId}/${id}/stream`;
}

export function libraryWaveformUrl(id: string): string {
  return `${BASE}/library/${id}/waveform`;
}

export function libraryWaveformUrlForUser(userId: string, id: string): string {
  return `${BASE}/library/user/${userId}/${id}/waveform`;
}
