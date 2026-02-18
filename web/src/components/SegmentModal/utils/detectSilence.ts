import type { WaveformData } from '../../../pages/EpisodeEditor/WaveformCanvas';

/** Amplitude threshold for "silence" - values within ±threshold are considered silent. 8-bit scale is -128..127. */
const SILENCE_THRESHOLD = 12;

/** Buffer (seconds) - trim starts this much later and ends this much earlier, preserving audio at the edges. */
const SILENCE_BUFFER_SEC = 0.25;

/**
 * Detect silence periods in waveform data. Returns trim ranges [startSec, endSec] for each
 * contiguous silence period longer than minSilenceSec. A small buffer is added before and
 * after each period to smooth transitions.
 */
export function detectSilencePeriods(
  waveformData: WaveformData | null,
  durationSec: number,
  minSilenceSec: number = 1
): Array<[number, number]> {
  if (!waveformData?.data?.length || durationSec <= 0) return [];

  const channels = Math.max(1, waveformData.channels ?? 1);
  const pairsPerChannel =
    typeof waveformData.length === 'number' && waveformData.length >= 0
      ? waveformData.length
      : Math.floor(waveformData.data.length / (2 * channels));
  if (pairsPerChannel <= 0) return [];

  const timePerPixel = durationSec / pairsPerChannel;
  const minSilencePixels = Math.ceil(minSilenceSec / timePerPixel);

  const ranges: Array<[number, number]> = [];
  let runStart: number | null = null;

  for (let i = 0; i < pairsPerChannel; i++) {
    const base = i * 2 * channels;
    const min = waveformData.data[base] ?? 0;
    const max = waveformData.data[base + 1] ?? 0;
    const isSilent = Math.abs(min) <= SILENCE_THRESHOLD && Math.abs(max) <= SILENCE_THRESHOLD;

    if (isSilent) {
      if (runStart === null) runStart = i;
    } else {
      if (runStart !== null) {
        const runLength = i - runStart;
        if (runLength >= minSilencePixels) {
          const rawStart = (runStart / pairsPerChannel) * durationSec;
          const rawEnd = (i / pairsPerChannel) * durationSec;
          const startSec = rawStart + SILENCE_BUFFER_SEC;
          const endSec = Math.max(startSec, rawEnd - SILENCE_BUFFER_SEC);
          ranges.push([startSec, endSec]);
        }
        runStart = null;
      }
    }
  }

  if (runStart !== null) {
    const runLength = pairsPerChannel - runStart;
    if (runLength >= minSilencePixels) {
      const rawStart = (runStart / pairsPerChannel) * durationSec;
      const startSec = rawStart + SILENCE_BUFFER_SEC;
      const endSec = durationSec;
      ranges.push([startSec, endSec]);
    }
  }

  return ranges;
}
