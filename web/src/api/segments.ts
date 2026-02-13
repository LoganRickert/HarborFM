import type { SegmentResponse, SegmentsListResponse, TranscriptTextResponse, TranscriptStatusResponse, RenderStatusResponse } from '@harborfm/shared';
import { csrfHeaders } from './client';

const BASE = '/api';

/** Segment as returned by API (from shared schema). */
export type EpisodeSegment = SegmentResponse;

export function listSegments(episodeId: string): Promise<SegmentsListResponse> {
  return fetch(`${BASE}/episodes/${episodeId}/segments`, { method: 'GET', credentials: 'include' }).then((r) => {
    if (!r.ok) return r.json().then((err: { error?: string }) => { throw new Error(err.error ?? r.statusText); });
    return r.json();
  });
}

export function addRecordedSegment(episodeId: string, file: File, name?: string | null): Promise<SegmentResponse> {
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

export function addReusableSegment(episodeId: string, reusableAssetId: string, name?: string | null): Promise<SegmentResponse> {
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

export function reorderSegments(episodeId: string, segmentIds: string[]): Promise<SegmentsListResponse> {
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

export function updateSegment(episodeId: string, segmentId: string, payload: { name: string | null }): Promise<SegmentResponse> {
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

export function getSegmentTranscript(episodeId: string, segmentId: string): Promise<TranscriptTextResponse> {
  return fetch(`${BASE}/episodes/${episodeId}/segments/${segmentId}/transcript`, { credentials: 'include' }).then((r) => {
    if (!r.ok) return r.json().then((err: { error?: string }) => { throw new Error(err.error ?? r.statusText); });
    return r.json();
  });
}

export function generateSegmentTranscript(episodeId: string, segmentId: string, regenerate?: boolean): Promise<TranscriptTextResponse> {
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

export function updateSegmentTranscript(episodeId: string, segmentId: string, text: string): Promise<TranscriptTextResponse> {
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

export function getEpisodeTranscript(episodeId: string): Promise<TranscriptTextResponse> {
  return fetch(`${BASE}/episodes/${episodeId}/transcript`, { credentials: 'include' }).then((r) => {
    if (!r.ok) return r.json().then((err: { error?: string }) => { throw new Error(err.error ?? r.statusText); });
    return r.json();
  });
}

/** Start transcript generation. Returns when job is started (202) or already in progress (409). Poll getTranscriptStatus until done/failed. */
export function startGenerateEpisodeTranscript(episodeId: string): Promise<void> {
  return fetch(`${BASE}/episodes/${episodeId}/generate-transcript`, {
    method: 'POST',
    credentials: 'include',
    headers: csrfHeaders(),
  }).then((r) => {
    if (r.status === 202 || r.status === 409) return;
    if (!r.ok) return r.json().then((err: { error?: string }) => { throw new Error(err.error ?? r.statusText); });
  });
}

export function getTranscriptStatus(episodeId: string): Promise<TranscriptStatusResponse> {
  return fetch(`${BASE}/episodes/${episodeId}/transcript-status`, { credentials: 'include' }).then((r) => {
    if (!r.ok) return r.json().then((err: { error?: string }) => { throw new Error(err.error ?? r.statusText); });
    return r.json();
  });
}

export function updateEpisodeTranscript(episodeId: string, text: string): Promise<TranscriptTextResponse> {
  return fetch(`${BASE}/episodes/${episodeId}/transcript`, {
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

/** Start building the final episode. Returns immediately; poll getRenderStatus until done or failed. */
export function startRenderEpisode(episodeId: string): Promise<{ status: 'building' | 'already_building'; message?: string }> {
  return fetch(`${BASE}/episodes/${episodeId}/render`, { method: 'POST', credentials: 'include', headers: csrfHeaders() }).then(async (r) => {
    const body = await r.json().catch(() => ({}));
    if (r.status === 202) return { status: 'building' as const };
    if (r.status === 409) return { status: 'already_building' as const, message: (body as { message?: string }).message ?? 'A build is already in progress.' };
    if (!r.ok) throw new Error((body as { error?: string }).error ?? r.statusText);
    return body;
  });
}

export function getRenderStatus(episodeId: string): Promise<RenderStatusResponse> {
  return fetch(`${BASE}/episodes/${episodeId}/render-status`, { method: 'GET', credentials: 'include' }).then((r) => {
    if (!r.ok) return r.json().then((err: { error?: string }) => { throw new Error(err.error ?? r.statusText); });
    return r.json();
  });
}
