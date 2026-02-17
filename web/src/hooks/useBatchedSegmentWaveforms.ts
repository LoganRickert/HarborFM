import { useState, useEffect, useRef } from 'react';
import { fetchSegmentWaveformsBulk } from '../api/segments';
import type { EpisodeSegment } from '../api/segments';
import type { WaveformData } from '../pages/EpisodeEditor/WaveformCanvas';

/** In-memory cache: waveform key -> WaveformData. Survives re-renders; instant load on revisit. */
const waveformCache = new Map<string, WaveformData>();

/** Key for cache invalidation: segment id + audio_path (changes after trim, etc.) */
function segmentWaveformKey(seg: EpisodeSegment): string {
  return `${seg.id}:${seg.audio_path ?? ''}`;
}

const BULK_MAX = 10;
const BULK_DELAY_MS = 150;

/** Fetch segment waveforms via bulk endpoint (10 at a time) to avoid 429 rate limits.
 * Only fetches segments where waveform_exists is true (server has file on disk).
 * Uses in-memory cache so repeat views load instantly. */
export function useBatchedSegmentWaveforms(
  episodeId: string,
  segments: EpisodeSegment[],
): Map<string, WaveformData | null> {
  const [waveforms, setWaveforms] = useState<Map<string, WaveformData | null>>(new Map());
  const abortRef = useRef<AbortController | null>(null);

  // Only fetch waveforms for segments that have one on disk (waveform_exists !== false).
  // When undefined (old server), assume true to avoid breaking.
  const toFetch = segments.filter((s) => {
    const hasWaveform = (s as { waveform_exists?: boolean }).waveform_exists;
    return (s.duration_sec ?? 0) > 0 && (hasWaveform === undefined || hasWaveform === true);
  });
  const fetchKey = toFetch.map(segmentWaveformKey).join('|');

  useEffect(() => {
    if (!episodeId || toFetch.length === 0) {
      setWaveforms(new Map());
      return;
    }

    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;

    // Seed from in-memory cache immediately so cached waveforms show without network delay
    const uncachedSegments = toFetch.filter((seg) => !waveformCache.has(segmentWaveformKey(seg)));
    const initial = new Map<string, WaveformData | null>();
    for (const seg of toFetch) {
      const cached = waveformCache.get(segmentWaveformKey(seg));
      if (cached) initial.set(seg.id, cached);
    }
    setWaveforms(initial);

    if (uncachedSegments.length === 0) return;

    void (async () => {
      const chunks: EpisodeSegment[][] = [];
      for (let i = 0; i < uncachedSegments.length; i += BULK_MAX) {
        chunks.push(uncachedSegments.slice(i, i + BULK_MAX));
      }
      const results: Map<string, WaveformData | null> = new Map();
      for (let i = 0; i < chunks.length; i++) {
        if (signal.aborted) return;
        if (i > 0) await new Promise((r) => setTimeout(r, BULK_DELAY_MS));
        const chunk = chunks[i]!;
        try {
          const { waveforms: wfMap } = await fetchSegmentWaveformsBulk(
            episodeId,
            chunk.map((s) => s.id),
          );
          for (const seg of chunk) {
            const wf = wfMap[seg.id];
            const waveform = wf?.data?.length ? (wf as WaveformData) : null;
            if (waveform) waveformCache.set(segmentWaveformKey(seg), waveform);
            results.set(seg.id, waveform ?? null);
          }
        } catch {
          for (const seg of chunk) results.set(seg.id, null);
        }
        if (signal.aborted) return;
        setWaveforms((prev) => {
          const next = new Map(prev);
          for (const [id, data] of results) next.set(id, data);
          return next;
        });
      }
    })();
    return () => {
      abortRef.current?.abort();
    };
  // fetchKey encodes segment identity; toFetch is derived and would cause re-runs every render (new array ref)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episodeId, fetchKey]);

  return waveforms;
}
