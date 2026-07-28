/**
 * Suggest gate / compressor settings from audiowaveform peak envelopes.
 * Heuristic for podcast speech: not a substitute for listening, but a solid start.
 */
import type { WaveformData } from '../../pages/EpisodeEditor/WaveformCanvas';
import { editorLaneKey, type EditorClip } from './clipOps';
import {
  clamp,
  COMP_THRESHOLD_DB_MAX,
  COMP_THRESHOLD_DB_MIN,
  GATE_THRESHOLD_DB_MAX,
  GATE_THRESHOLD_DB_MIN,
  linearToDb,
  thresholdLinearToDb,
  VOLUME_DB_MAX,
  VOLUME_DB_MIN,
  type TrackSettingsUi,
} from './trackFx';

function takeBasename(filePath: string): string {
  return filePath.replace(/\\/g, '/').split('/').pop() || filePath;
}

/** Short takes (e.g. 1s blade) may only have a handful of audiowaveform pairs. */
export const MIN_AUTO_PEAKS = 2;

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const t = clamp(p, 0, 1) * (sorted.length - 1);
  const i = Math.floor(t);
  const f = t - i;
  const a = sorted[i]!;
  const b = sorted[Math.min(sorted.length - 1, i + 1)]!;
  return a + (b - a) * f;
}

/**
 * Collect peak magnitudes (0..1) from the full take waveform(s) on this lane.
 * Lane FX apply to every clip, so Auto must analyze the whole take, not a
 * short blade slice on the timeline.
 */
export function collectLanePeaks(
  clips: EditorClip[],
  laneKey: string,
  waveforms: Record<string, WaveformData | null | undefined>,
): number[] {
  const peaks: number[] = [];
  const seenTakes = new Set<string>();

  const resolveWaveform = (
    filePath: string,
  ): WaveformData | null | undefined => {
    const base = takeBasename(filePath);
    return (
      waveforms[base] ??
      waveforms[filePath] ??
      waveforms[filePath.replace(/\\/g, '/')] ??
      null
    );
  };

  for (const clip of clips) {
    if (editorLaneKey(clip) !== laneKey) continue;
    const base = takeBasename(clip.filePath);
    if (seenTakes.has(base)) continue;
    seenTakes.add(base);

    const wf = resolveWaveform(clip.filePath);
    if (!wf?.data?.length) continue;
    const raw = wf.data;
    const pairs =
      wf.length > 0 ? wf.length : Math.floor(raw.length / 2);
    if (pairs <= 0) continue;

    const bits = wf.bits ?? 8;
    const scale = 2 ** (bits - 1);
    // Subsample long takes so Auto stays snappy.
    const step = Math.max(1, Math.floor(pairs / 8000));
    for (let pair = 0; pair < pairs; pair += step) {
      const i = pair * 2;
      if (i + 1 >= raw.length) break;
      let minV = raw[i]! / scale;
      let maxV = raw[i + 1]! / scale;
      if (minV > maxV) {
        const tmp = minV;
        minV = maxV;
        maxV = tmp;
      }
      const peak = Math.max(Math.abs(minV), Math.abs(maxV));
      if (Number.isFinite(peak)) peaks.push(Math.min(1, peak));
    }
  }
  return peaks;
}

/**
 * Peak magnitudes for one clip's source region (for per-clip Auto FX).
 */
export function collectClipPeaks(
  clip: EditorClip,
  waveforms: Record<string, WaveformData | null | undefined>,
): number[] {
  const peaks: number[] = [];
  const base = takeBasename(clip.filePath);
  const wf =
    waveforms[base] ??
    waveforms[clip.filePath] ??
    waveforms[clip.filePath.replace(/\\/g, '/')] ??
    null;
  if (!wf?.data?.length) return peaks;

  const raw = wf.data;
  const pairs = wf.length > 0 ? wf.length : Math.floor(raw.length / 2);
  if (pairs <= 0) return peaks;

  const bits = wf.bits ?? 8;
  const scale = 2 ** (bits - 1);
  const spp = wf.samples_per_pixel ?? 0;
  const sr = wf.sample_rate ?? 0;
  const durationSec =
    pairs > 0 && spp > 0 && sr > 0 ? (pairs * spp) / sr : 0;

  const srcStartSec =
    typeof clip.sourceOffsetMs === 'number' && clip.sourceOffsetMs > 0
      ? clip.sourceOffsetMs / 1000
      : 0;
  let srcLenSec =
    typeof clip.lengthMs === 'number' && clip.lengthMs > 0
      ? clip.lengthMs / 1000
      : 0;
  if (
    srcLenSec <= 0 &&
    typeof clip.endMs === 'number' &&
    typeof clip.startMs === 'number'
  ) {
    srcLenSec = Math.max(0, (clip.endMs - clip.startMs) / 1000);
  }

  let pairStart = 0;
  let pairEnd = pairs;
  if (durationSec > 0 && srcLenSec > 0) {
    pairStart = Math.max(0, Math.floor((srcStartSec / durationSec) * pairs));
    pairEnd = Math.min(
      pairs,
      Math.ceil(((srcStartSec + srcLenSec) / durationSec) * pairs),
    );
  }

  const span = Math.max(1, pairEnd - pairStart);
  const step = Math.max(1, Math.floor(span / 8000));
  for (let pair = pairStart; pair < pairEnd; pair += step) {
    const i = pair * 2;
    if (i + 1 >= raw.length) break;
    let minV = raw[i]! / scale;
    let maxV = raw[i + 1]! / scale;
    if (minV > maxV) {
      const tmp = minV;
      minV = maxV;
      maxV = tmp;
    }
    const peak = Math.max(Math.abs(minV), Math.abs(maxV));
    if (Number.isFinite(peak)) peaks.push(Math.min(1, peak));
  }
  return peaks;
}

/** Raw amplitude → dBFS (not clamped to the volume fader range). */
function ampToDb(linear: number): number {
  if (!Number.isFinite(linear) || linear <= 0) return -120;
  return 20 * Math.log10(linear);
}

/**
 * Suggest track volume. Prefers unity (0 dB) when the take is already in a
 * healthy range; only boosts quiet takes or trims hot peaks.
 */
export function suggestVolumeFromPeaks(
  peaks: number[],
): Pick<TrackSettingsUi, 'muted' | 'volumeDb'> | null {
  if (peaks.length < MIN_AUTO_PEAKS) return null;
  const sorted = [...peaks].sort((a, b) => a - b);

  const p20 = percentile(sorted, 0.2);
  const p50 = percentile(sorted, 0.5);
  const activeFloor = Math.max(p20 * 1.5, p50 * 0.3, 0.006);
  let active = sorted.filter((p) => p >= activeFloor);
  if (active.length < Math.min(4, sorted.length)) {
    active = sorted.filter((p) => p >= Math.max(p50 * 0.4, 0.01));
  }
  if (active.length < MIN_AUTO_PEAKS) {
    active = sorted.filter((p) => p > 0);
  }
  if (active.length < MIN_AUTO_PEAKS) active = sorted;
  if (!active.length) return null;

  const peakLin = Math.max(percentile(active, 0.95), 0.005);
  const peakDb = ampToDb(peakLin);

  // Healthy recorded takes usually sit near here already → leave fader at 0.
  const HEALTHY_PEAK_LO = -18;
  const HEALTHY_PEAK_HI = -1.5;
  const QUIET_TARGET_PEAK = -8;
  const HOT_TARGET_PEAK = -3;

  let gainDb = 0;
  if (peakDb < HEALTHY_PEAK_LO) {
    gainDb = QUIET_TARGET_PEAK - peakDb;
  } else if (peakDb > HEALTHY_PEAK_HI) {
    gainDb = HOT_TARGET_PEAK - peakDb;
  } else {
    gainDb = 0;
  }

  // Snap tiny corrections to unity.
  if (Math.abs(gainDb) < 1.5) gainDb = 0;

  const volumeDb = clamp(
    Math.round(gainDb * 2) / 2,
    VOLUME_DB_MIN,
    VOLUME_DB_MAX,
  );

  return {
    muted: false,
    volumeDb,
  };
}

/** Suggest gate settings; enables gate. Returns null if not enough signal. */
export function suggestGateFromPeaks(
  peaks: number[],
): Pick<
  TrackSettingsUi,
  | 'gateEnabled'
  | 'gateThresholdDb'
  | 'gateAttackMs'
  | 'gateHoldMs'
  | 'gateReleaseMs'
> | null {
  if (peaks.length < MIN_AUTO_PEAKS) return null;
  const sorted = [...peaks].sort((a, b) => a - b);

  // Quiet floor from the bottom of the envelope (chair / room noise).
  const quietCut = percentile(sorted, 0.35);
  const quiet = sorted.filter((p) => p <= quietCut);
  const noise = Math.max(
    percentile(quiet.length ? quiet : sorted, 0.5),
    percentile(sorted, 0.1),
    0.002,
  );

  // Speech body from louder activity (ignore near-floor samples).
  const activeFloor = Math.max(noise * 3, percentile(sorted, 0.45));
  let active = sorted.filter((p) => p >= activeFloor);
  if (active.length < MIN_AUTO_PEAKS) {
    active = sorted.filter((p) => p > noise * 2);
  }
  if (active.length < MIN_AUTO_PEAKS) return null;
  const speech = Math.max(percentile(active, 0.5), noise * 6);
  if (speech < 0.02) return null;

  // Bias toward speech so movement / rustle stays closed. Require at least
  // ~14 dB above the estimated noise floor.
  const biased = Math.pow(noise, 0.28) * Math.pow(speech, 0.72);
  const minAboveNoise = noise * Math.pow(10, 14 / 20);
  const threshLinear = clamp(
    Math.max(biased, minAboveNoise),
    noise * 4,
    speech * 0.72,
  );
  const gateThresholdDb = clamp(
    thresholdLinearToDb(Math.max(0.0001, threshLinear)),
    GATE_THRESHOLD_DB_MIN,
    GATE_THRESHOLD_DB_MAX,
  );

  return {
    gateEnabled: true,
    gateThresholdDb,
    gateAttackMs: 3,
    gateHoldMs: 40,
    gateReleaseMs: 90,
  };
}

/** Suggest compressor settings; enables compressor. */
export function suggestCompFromPeaks(
  peaks: number[],
): Pick<
  TrackSettingsUi,
  | 'compEnabled'
  | 'compThresholdDb'
  | 'compRatio'
  | 'compAttackMs'
  | 'compReleaseMs'
  | 'compMakeupDb'
> | null {
  if (peaks.length < MIN_AUTO_PEAKS) return null;
  const sorted = [...peaks].sort((a, b) => a - b);
  const p20 = percentile(sorted, 0.2);
  const p95 = percentile(sorted, 0.95);
  const activeFloor = Math.max(p20 * 2, 0.02);
  let active = sorted.filter((p) => p >= activeFloor);
  if (active.length < MIN_AUTO_PEAKS) {
    active = sorted.filter((p) => p > 0.01);
  }
  if (active.length < MIN_AUTO_PEAKS) return null;

  const speech = percentile(active, 0.55);
  const crest = Math.max(0.001, p95 / Math.max(speech, 0.01));
  // Threshold a bit under typical speech peaks so it rides the body of the signal.
  const threshLinear = clamp(speech * 0.85, 0.02, 0.7);
  const compThresholdDb = clamp(
    thresholdLinearToDb(threshLinear),
    COMP_THRESHOLD_DB_MIN,
    COMP_THRESHOLD_DB_MAX,
  );

  let ratio = 3;
  if (crest > 6) ratio = 5;
  else if (crest > 4) ratio = 4;
  else if (crest > 2.5) ratio = 3;
  else ratio = 2.5;

  // Rough expected GR at peaks → a little makeup, capped.
  const peakDb = linearToDb(Math.max(p95, threshLinear));
  const overDb = Math.max(0, peakDb - compThresholdDb);
  const grDb = overDb - overDb / ratio;
  const makeupDb = clamp(Math.round(grDb * 0.65 * 2) / 2, 0, 8);

  return {
    compEnabled: true,
    compThresholdDb,
    compRatio: ratio,
    compAttackMs: 10,
    compReleaseMs: 100,
    compMakeupDb: makeupDb,
  };
}
