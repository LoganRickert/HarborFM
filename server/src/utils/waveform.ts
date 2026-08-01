import { existsSync, readFileSync, statSync } from "fs";
import { copyFileSync } from "fs";

/** Reject absurdly large waveform sidecars (DoS / non-waveform dumps). */
const MAX_WAVEFORM_BYTES = 32 * 1024 * 1024;

export type AudiowaveformJson = {
  version?: number;
  channels?: number;
  sample_rate: number;
  samples_per_pixel: number;
  bits: number;
  length: number;
  data: number[];
};

/**
 * Media duration implied by audiowaveform peak metadata.
 * Returns null when required fields are missing or empty.
 */
export function waveformDurationSec(
  waveform: Pick<
    AudiowaveformJson,
    "length" | "sample_rate" | "samples_per_pixel"
  >,
): number | null {
  const length =
    typeof waveform.length === "number" && waveform.length > 0
      ? waveform.length
      : null;
  const sampleRate =
    typeof waveform.sample_rate === "number" && waveform.sample_rate > 0
      ? waveform.sample_rate
      : null;
  const spp =
    typeof waveform.samples_per_pixel === "number" &&
    waveform.samples_per_pixel > 0
      ? waveform.samples_per_pixel
      : null;
  if (length == null || sampleRate == null || spp == null) return null;
  const dur = (length * spp) / sampleRate;
  return Number.isFinite(dur) && dur > 0 ? dur : null;
}

/**
 * Structural check that `value` looks like audiowaveform JSON (not arbitrary JSON).
 * Optionally requires duration to align with expectedDurationSec.
 */
export function isValidAudiowaveformJson(
  value: unknown,
  opts?: { expectedDurationSec?: number },
): value is AudiowaveformJson {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const w = value as Record<string, unknown>;

  if (w.version !== undefined) {
    if (w.version !== 1 && w.version !== 2) return false;
  }

  const channels =
    w.channels === undefined
      ? 1
      : typeof w.channels === "number" &&
          Number.isInteger(w.channels) &&
          w.channels >= 1 &&
          w.channels <= 8
        ? w.channels
        : null;
  if (channels == null) return false;

  if (
    typeof w.sample_rate !== "number" ||
    !Number.isFinite(w.sample_rate) ||
    w.sample_rate < 8000 ||
    w.sample_rate > 192000
  ) {
    return false;
  }
  if (
    typeof w.samples_per_pixel !== "number" ||
    !Number.isInteger(w.samples_per_pixel) ||
    w.samples_per_pixel < 1 ||
    w.samples_per_pixel > 1_000_000
  ) {
    return false;
  }
  if (w.bits !== 8 && w.bits !== 16) return false;
  if (
    typeof w.length !== "number" ||
    !Number.isInteger(w.length) ||
    w.length < 1 ||
    w.length > 50_000_000
  ) {
    return false;
  }
  if (!Array.isArray(w.data) || w.data.length < 2) return false;

  const expectedSamples = w.length * channels * 2;
  if (w.data.length !== expectedSamples) return false;

  const min = w.bits === 8 ? -128 : -32768;
  const max = w.bits === 8 ? 127 : 32767;
  const step =
    w.data.length <= 200_000 ? 1 : Math.max(1, Math.floor(w.data.length / 50_000));
  for (let i = 0; i < w.data.length; i += step) {
    const v = w.data[i];
    if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) {
      return false;
    }
  }
  // Always verify the last sample (step may skip it).
  const last = w.data[w.data.length - 1];
  if (
    typeof last !== "number" ||
    !Number.isFinite(last) ||
    last < min ||
    last > max
  ) {
    return false;
  }

  const dur = waveformDurationSec({
    length: w.length,
    sample_rate: w.sample_rate,
    samples_per_pixel: w.samples_per_pixel,
  });
  if (dur == null) return false;

  const expected = opts?.expectedDurationSec;
  if (
    typeof expected === "number" &&
    Number.isFinite(expected) &&
    expected > 0
  ) {
    const tol = Math.max(5, expected * 0.25);
    if (Math.abs(dur - expected) > tol) return false;
  }

  return true;
}

/** Parse and validate a waveform file on disk. Returns null when bogus/unreadable. */
export function readValidAudiowaveformFile(
  path: string,
  opts?: { expectedDurationSec?: number },
): AudiowaveformJson | null {
  if (!existsSync(path)) return null;
  try {
    const size = statSync(path).size;
    if (size <= 0 || size > MAX_WAVEFORM_BYTES) return null;
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return isValidAudiowaveformJson(parsed, opts) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Copy waveform sidecar only when it parses as legitimate audiowaveform JSON.
 * Returns false when missing or bogus (caller should regenerate).
 */
export function tryCopyValidatedWaveform(
  src: string,
  dest: string,
  opts?: { expectedDurationSec?: number },
): boolean {
  if (!readValidAudiowaveformFile(src, opts)) return false;
  copyFileSync(src, dest);
  return true;
}
