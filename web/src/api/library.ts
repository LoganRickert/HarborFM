import { csrfHeaders } from './client';

const BASE = '/api';

export interface LibraryAsset {
  id: string;
  owner_user_id?: string;
  name: string;
  tag: string | null;
  duration_sec: number;
  created_at: string;
  global_asset?: boolean | number;
}

export function listLibrary(): Promise<{ assets: LibraryAsset[] }> {
  return fetch(`${BASE}/library`, { method: 'GET', credentials: 'include' }).then((r) => {
    if (!r.ok) return r.json().then((err: { error?: string }) => { throw new Error(err.error ?? r.statusText); });
    return r.json();
  });
}

export function listLibraryForUser(userId: string): Promise<{ assets: LibraryAsset[] }> {
  return fetch(`${BASE}/library/user/${userId}`, { method: 'GET', credentials: 'include' }).then((r) => {
    if (!r.ok) return r.json().then((err: { error?: string }) => { throw new Error(err.error ?? r.statusText); });
    return r.json();
  });
}

export function createLibraryAsset(file: File, name: string, tag?: string | null): Promise<LibraryAsset> {
  const form = new FormData();
  form.append('name', name);
  if (tag) form.append('tag', tag);
  form.append('file', file);
  const res = fetch(`${BASE}/library`, {
    method: 'POST',
    credentials: 'include',
    headers: csrfHeaders(),
    body: form,
  });
  return res.then((r) => {
    if (!r.ok) return r.json().then((err: { error?: string }) => { throw new Error(err.error ?? r.statusText); });
    return r.json();
  });
}

export function updateLibraryAsset(id: string, data: { name?: string; tag?: string | null; global_asset?: boolean }): Promise<LibraryAsset> {
  return fetch(`${BASE}/library/${id}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
    body: JSON.stringify(data),
  }).then((r) => {
    if (!r.ok) return r.json().then((err: { error?: string }) => { throw new Error(err.error ?? r.statusText); });
    return r.json();
  });
}

export function updateLibraryAssetForUser(userId: string, id: string, data: { name?: string; tag?: string | null; global_asset?: boolean }): Promise<LibraryAsset> {
  return fetch(`${BASE}/library/user/${userId}/${id}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
    body: JSON.stringify(data),
  }).then((r) => {
    if (!r.ok) return r.json().then((err: { error?: string }) => { throw new Error(err.error ?? r.statusText); });
    return r.json();
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
