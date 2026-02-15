import { useState, useEffect, useRef } from 'react';
import { segmentWaveformUrl } from '../api/segments';
import type { EpisodeSegment } from '../api/segments';
import type { WaveformData } from '../pages/EpisodeEditor/WaveformCanvas';

const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 1000;

/** Key for cache invalidation: segment id + audio_path (changes after trim, etc.) */
function segmentWaveformKey(seg: EpisodeSegment): string {
  return `${seg.id}:${seg.audio_path ?? ''}`;
}

/** Fetch segment waveforms in batches (5 at a time, 1s between batches) to avoid 429 rate limits. */
export function useBatchedSegmentWaveforms(
  episodeId: string,
  segments: EpisodeSegment[],
): Map<string, WaveformData | null> {
  const [waveforms, setWaveforms] = useState<Map<string, WaveformData | null>>(new Map());
  const abortRef = useRef<AbortController | null>(null);

  const toFetch = segments.filter((s) => (s.duration_sec ?? 0) > 0);
  const fetchKey = toFetch.map(segmentWaveformKey).join('|');

  useEffect(() => {
    if (!episodeId || toFetch.length === 0) {
      setWaveforms(new Map());
      return;
    }

    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;

    setWaveforms(new Map());

    let batchIndex = 0;

    async function fetchBatch() {
      const start = batchIndex * BATCH_SIZE;
      const batch = toFetch.slice(start, start + BATCH_SIZE);
      if (batch.length === 0) return;

      const results = await Promise.all(
        batch.map(async (seg) => {
          try {
            const r = await fetch(segmentWaveformUrl(episodeId, seg.id), {
              credentials: 'include',
              signal,
            });
            const data = r.ok ? await r.json() : null;
            return {
              segmentId: seg.id,
              data: data?.data?.length ? (data as WaveformData) : null,
            };
          } catch {
            return { segmentId: seg.id, data: null };
          }
        }),
      );

      if (signal.aborted) return;

      setWaveforms((prev) => {
        const next = new Map(prev);
        for (const { segmentId, data } of results) {
          next.set(segmentId, data);
        }
        return next;
      });

      batchIndex++;
      const nextStart = batchIndex * BATCH_SIZE;
      if (nextStart < toFetch.length) {
        setTimeout(() => void fetchBatch(), BATCH_DELAY_MS);
      }
    }

    void fetchBatch();
    return () => {
      abortRef.current?.abort();
    };
  // fetchKey encodes segment identity; toFetch is derived and would cause re-runs every render (new array ref)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episodeId, fetchKey]);

  return waveforms;
}
