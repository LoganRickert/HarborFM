import { csrfHeaders } from './client';

const BASE = '/api';

export async function uploadEpisodeAudio(episodeId: string, file: File): Promise<unknown> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${BASE}/episodes/${episodeId}/audio`, {
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

export async function processEpisodeAudio(episodeId: string): Promise<unknown> {
  const res = await fetch(`${BASE}/episodes/${episodeId}/process-audio`, {
    method: 'POST',
    credentials: 'include',
    headers: csrfHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? res.statusText);
  }
  return res.json();
}

export function downloadEpisodeUrl(episodeId: string, type: 'source' | 'final' = 'final'): string {
  return `${BASE}/episodes/${episodeId}/download?type=${type}`;
}
