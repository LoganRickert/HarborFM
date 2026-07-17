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

/** Authenticated download of episode project zip (editors and above). Prefer prepare + status first. */
export function downloadProjectUrl(episodeId: string): string {
  return `${BASE}/episodes/${episodeId}/project-export`;
}

export type ProjectExportStatusResponse = {
  status: 'idle' | 'building' | 'ready' | 'failed';
  error?: string;
};

/** Start project zip build. 202 or 409 (already building) both OK. Poll getProjectExportStatus. */
export function startProjectExport(episodeId: string): Promise<void> {
  return fetch(`${BASE}/episodes/${episodeId}/project-export/prepare`, {
    method: 'POST',
    credentials: 'include',
    headers: csrfHeaders(),
  }).then((r) => {
    if (r.status === 202 || r.status === 409) return;
    if (!r.ok) {
      return r.json().then((err: { error?: string }) => {
        throw new Error(err.error ?? r.statusText);
      });
    }
  });
}

export function getProjectExportStatus(episodeId: string): Promise<ProjectExportStatusResponse> {
  return fetch(`${BASE}/episodes/${episodeId}/project-export/status`, {
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

export function downloadSoundbiteUrl(
  episodeId: string,
  opts: { start: number; duration: number; title?: string },
): string {
  const params = new URLSearchParams({
    start: String(opts.start),
    duration: String(opts.duration),
  });
  if (opts.title?.trim()) params.set('title', opts.title.trim());
  return `${BASE}/episodes/${episodeId}/soundbite?${params.toString()}`;
}

export function finalEpisodeWaveformUrl(episodeId: string): string {
  return `${BASE}/episodes/${episodeId}/final-waveform`;
}
