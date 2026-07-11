import type {
  ShowNotesListResponse,
  ShowNotesItem,
  ShowNotesPatchBody,
  ShowNotesCreateItemBody,
  ShowNotesUpdateItemBody,
} from '@harborfm/shared';
import { csrfHeaders } from './client';

const BASE = '/api';

export const showNotesQueryKey = (episodeId: string) => ['show-notes', episodeId] as const;

export function getShowNotes(episodeId: string): Promise<ShowNotesListResponse> {
  return fetch(`${BASE}/episodes/${episodeId}/show-notes`, {
    method: 'GET',
    credentials: 'include',
  }).then((r) => {
    if (!r.ok) return r.json().then((err: { error?: string }) => { throw new Error(err.error ?? r.statusText); });
    return r.json();
  });
}

export function patchShowNotesSettings(
  episodeId: string,
  body: ShowNotesPatchBody,
): Promise<ShowNotesListResponse> {
  return fetch(`${BASE}/episodes/${episodeId}/show-notes`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
    body: JSON.stringify(body),
  }).then((r) => {
    if (!r.ok) return r.json().then((err: { error?: string }) => { throw new Error(err.error ?? r.statusText); });
    return r.json();
  });
}

export function createShowNotesItem(
  episodeId: string,
  body?: ShowNotesCreateItemBody,
): Promise<ShowNotesItem> {
  return fetch(`${BASE}/episodes/${episodeId}/show-notes/items`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
    body: JSON.stringify(body ?? {}),
  }).then((r) => {
    if (!r.ok) return r.json().then((err: { error?: string }) => { throw new Error(err.error ?? r.statusText); });
    return r.json();
  });
}

export function updateShowNotesItem(
  episodeId: string,
  itemId: string,
  body: ShowNotesUpdateItemBody,
): Promise<ShowNotesItem> {
  return fetch(`${BASE}/episodes/${episodeId}/show-notes/items/${itemId}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
    body: JSON.stringify(body),
  }).then((r) => {
    if (!r.ok) return r.json().then((err: { error?: string }) => { throw new Error(err.error ?? r.statusText); });
    return r.json();
  });
}

export function reorderShowNotesItems(
  episodeId: string,
  itemIds: string[],
): Promise<{ items: ShowNotesItem[] }> {
  return fetch(`${BASE}/episodes/${episodeId}/show-notes/items/reorder`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
    body: JSON.stringify({ itemIds }),
  }).then((r) => {
    if (!r.ok) return r.json().then((err: { error?: string }) => { throw new Error(err.error ?? r.statusText); });
    return r.json();
  });
}

export function deleteShowNotesItem(episodeId: string, itemId: string): Promise<{ ok: boolean }> {
  return fetch(`${BASE}/episodes/${episodeId}/show-notes/items/${itemId}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: csrfHeaders(),
  }).then((r) => {
    if (!r.ok) return r.json().then((err: { error?: string }) => { throw new Error(err.error ?? r.statusText); });
    return r.json();
  });
}
