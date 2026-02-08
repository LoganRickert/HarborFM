import { csrfHeaders } from './client';

const BASE = '/api';

export interface EpisodeSegment {
  id: string;
  episode_id: string;
  position: number;
  type: 'recorded' | 'reusable';
  name?: string | null;
  reusable_asset_id?: string | null;
  asset_name?: string | null;
  audio_path?: string | null;
  duration_sec: number;
  created_at: string;
}

export function listSegments(episodeId: string): Promise<{ segments: EpisodeSegment[] }> {
  return fetch(`${BASE}/episodes/${episodeId}/segments`, { method: 'GET', credentials: 'include' }).then((r) => {
    if (!r.ok) return r.json().then((err: { error?: string }) => { throw new Error(err.error ?? r.statusText); });
    return r.json();
  });
}

export function addRecordedSegment(episodeId: string, file: File, name?: string | null): Promise<EpisodeSegment> {
  const form = new FormData();
  if (name != null && name.trim()) form.append('name', name.trim());
  form.append('file', file);
  return fetch(`${BASE}/episodes/${episodeId}/segments`, {
    method: 'POST',
    credentials: 'include',
    headers: csrfHeaders(),
    body: form,
  }).then((r) => {
    if (!r.ok) return r.json().then((err: { error?: string }) => { throw new Error(err.error ?? r.statusText); });
    return r.json();
  });
}

export function addReusableSegment(episodeId: string, reusableAssetId: string, name?: string | null): Promise<EpisodeSegment> {
  return fetch(`${BASE}/episodes/${episodeId}/segments`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
    body: JSON.stringify({ type: 'reusable', reusable_asset_id: reusableAssetId, name: name ?? undefined }),
  }).then((r) => {
    if (!r.ok) return r.json().then((err: { error?: string }) => { throw new Error(err.error ?? r.statusText); });
    return r.json();
  });
}

export function reorderSegments(episodeId: string, segmentIds: string[]): Promise<{ segments: EpisodeSegment[] }> {
  return fetch(`${BASE}/episodes/${episodeId}/segments/reorder`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
    body: JSON.stringify({ segment_ids: segmentIds }),
  }).then((r) => {
    if (!r.ok) return r.json().then((err: { error?: string }) => { throw new Error(err.error ?? r.statusText); });
    return r.json();
  });
}

export function updateSegment(episodeId: string, segmentId: string, payload: { name: string | null }): Promise<EpisodeSegment> {
  return fetch(`${BASE}/episodes/${episodeId}/segments/${segmentId}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
    body: JSON.stringify(payload),
  }).then((r) => {
    if (!r.ok) return r.json().then((err: { error?: string }) => { throw new Error(err.error ?? r.statusText); });
    return r.json();
  });
}

/** Include audioPath to bust cache when the segment file changes (e.g. after trim → new .wav). */
export function segmentStreamUrl(episodeId: string, segmentId: string, audioPath?: string | null): string {
  const url = `${BASE}/episodes/${episodeId}/segments/${segmentId}/stream`;
  if (audioPath) {
    return `${url}?v=${encodeURIComponent(audioPath)}`;
  }
  return url;
}

export function segmentWaveformUrl(episodeId: string, segmentId: string): string {
  return `${BASE}/episodes/${episodeId}/segments/${segmentId}/waveform`;
}

export function getSegmentTranscript(episodeId: string, segmentId: string): Promise<{ text: string }> {
  return fetch(`${BASE}/episodes/${episodeId}/segments/${segmentId}/transcript`, { credentials: 'include' }).then((r) => {
    if (!r.ok) return r.json().then((err: { error?: string }) => { throw new Error(err.error ?? r.statusText); });
    return r.json();
  });
}

export function generateSegmentTranscript(episodeId: string, segmentId: string, regenerate?: boolean): Promise<{ text: string }> {
  const url = new URL(`${BASE}/episodes/${episodeId}/segments/${segmentId}/transcript`, window.location.origin);
  if (regenerate) {
    url.searchParams.set('regenerate', 'true');
  }
  return fetch(url.toString(), {
    method: 'POST',
    credentials: 'include',
    headers: csrfHeaders(),
  }).then((r) => {
    if (!r.ok) return r.json().then((err: { error?: string }) => { throw new Error(err.error ?? r.statusText); });
    return r.json();
  });
}

export function deleteSegment(episodeId: string, segmentId: string): Promise<void> {
  return fetch(`${BASE}/episodes/${episodeId}/segments/${segmentId}`, { method: 'DELETE', credentials: 'include', headers: csrfHeaders() }).then((r) => {
    if (!r.ok) return r.json().then((err: { error?: string }) => { throw new Error(err.error ?? r.statusText); });
  });
}

export function updateSegmentTranscript(episodeId: string, segmentId: string, text: string): Promise<{ text: string }> {
  return fetch(`${BASE}/episodes/${episodeId}/segments/${segmentId}/transcript`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
    body: JSON.stringify({ text }),
  }).then((r) => {
    if (!r.ok) return r.json().then((err: { error?: string }) => { throw new Error(err.error ?? r.statusText); });
    return r.json();
  });
}

export function deleteSegmentTranscript(episodeId: string, segmentId: string, entryIndex?: number): Promise<{ text?: string }> {
  const url = new URL(`${BASE}/episodes/${episodeId}/segments/${segmentId}/transcript`, window.location.origin);
  if (typeof entryIndex === 'number') {
    url.searchParams.set('entryIndex', String(entryIndex));
  }
  return fetch(url.toString(), { method: 'DELETE', credentials: 'include', headers: csrfHeaders() }).then((r) => {
    if (!r.ok) return r.json().then((err: { error?: string }) => { throw new Error(err.error ?? r.statusText); });
    if (r.status === 204) return {};
    return r.json();
  });
}

export function trimSegmentAudio(episodeId: string, segmentId: string, startSec?: number, endSec?: number): Promise<void> {
  const body: { start_sec?: number; end_sec?: number } = {};
  if (startSec !== undefined) body.start_sec = startSec;
  if (endSec !== undefined) body.end_sec = endSec;
  return fetch(`${BASE}/episodes/${episodeId}/segments/${segmentId}/trim`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
    body: JSON.stringify(body),
  }).then((r) => {
    if (!r.ok) return r.json().then((err: { error?: string }) => { throw new Error(err.error ?? r.statusText); });
  });
}

export function removeSilenceFromSegment(episodeId: string, segmentId: string, thresholdSeconds?: number, silenceThreshold?: number): Promise<void> {
  const body: { threshold_seconds?: number; silence_threshold?: number } = {};
  if (thresholdSeconds !== undefined) body.threshold_seconds = thresholdSeconds;
  if (silenceThreshold !== undefined) body.silence_threshold = silenceThreshold;
  return fetch(`${BASE}/episodes/${episodeId}/segments/${segmentId}/remove-silence`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
    body: JSON.stringify(body),
  }).then((r) => {
    if (!r.ok) return r.json().then((err: { error?: string }) => { throw new Error(err.error ?? r.statusText); });
  });
}

/** Apply FFT-based noise suppression (afftdn). Client sends nf=-25 by default; server accepts nf in body for future customization. */
export function applyNoiseSuppressionToSegment(episodeId: string, segmentId: string, nf: number = -25): Promise<void> {
  return fetch(`${BASE}/episodes/${episodeId}/segments/${segmentId}/noise-suppression`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
    body: JSON.stringify({ nf }),
  }).then((r) => {
    if (!r.ok) return r.json().then((err: { error?: string }) => { throw new Error(err.error ?? r.statusText); });
  });
}

export function renderEpisode(episodeId: string): Promise<unknown> {
  return fetch(`${BASE}/episodes/${episodeId}/render`, { method: 'POST', credentials: 'include', headers: csrfHeaders() }).then((r) => {
    if (!r.ok) return r.json().then((err: { error?: string }) => { throw new Error(err.error ?? r.statusText); });
    return r.json();
  });
}
