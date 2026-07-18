import { execFile } from "child_process";
import { randomUUID } from "crypto";
import { promisify } from "util";
import { basename, join, resolve } from "path";
import { existsSync, mkdirSync, statSync, unlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { FFMPEG_PATH } from "../config.js";
import { assertPathUnder, assertResolvedPathUnder } from "./paths.js";
import * as audioService from "./audio.js";
import {
  buildCompFilterParts,
  buildGateFilterParts,
} from "../modules/episodes/projectReaperDynamics.js";
import { buildEqFilterParts } from "../modules/episodes/projectReaperEq.js";

const exec = promisify(execFile);

/** LUFS target matching webrtc-service RecordingManager.runAmixAndDeliver. */
const SEGMENT_LOUDNESS_TARGET_LUFS = -18;
const MIN_SEGMENT_BYTES = 1024;

export type MultitrackEqBand = {
  type:
    | "hipass"
    | "loshelf"
    | "band"
    | "notch"
    | "hishelf"
    | "lopass"
    | "bandpass";
  freqHz: number;
  gainDb: number;
  q: number;
  enabled?: boolean;
};

export type MultitrackGateParams = {
  threshold: number;
  attackMs: number;
  holdMs?: number;
  releaseMs: number;
  range?: number;
};

export type MultitrackCompParams = {
  threshold: number;
  ratio: number;
  attackMs: number;
  releaseMs: number;
  makeupDb?: number;
  kneeDb?: number;
};

export type MultitrackSegmentEntry = {
  segmentId?: string;
  startMs?: number;
  endMs?: number;
  filePath?: string;
  /** Linear amplitude (1 = 0 dB). Kept even when muted so export can restore the fader. */
  volume?: number;
  /** Reaper track/item mute; muted clips are omitted from the remake mix. */
  muted?: boolean;
  fileSha256?: string;
  waveformSha256?: string;
  /** Media in-point in milliseconds (trim start into the source file). */
  sourceOffsetMs?: number;
  /** Play length on the timeline in milliseconds. */
  lengthMs?: number;
  participantName?: string | null;
  participantId?: string | null;
  source?: string | null;
  soundboardAssetId?: string | null;
  /** Reaper item PLAYRATE first param (timeline speed). Default 1. */
  playRate?: number;
  /** Reaper PLAYRATE preserve-pitch flag. Default true. */
  preservePitch?: boolean;
  /** Extra pitch adjust in semitones (PLAYRATE third param). */
  pitchSemitones?: number;
  fadeInSec?: number;
  fadeOutSec?: number;
  /** Reaper item LOOP: loop source to fill lengthMs. */
  loop?: boolean;
  /** Track-level ReaEQ bands (copied onto each clip on that track). */
  eqBands?: MultitrackEqBand[];
  /** Original ReaEQ VST chunk (base64) for bit-identical export when present. */
  reaEqChunkBase64?: string;
  /** Track-level ReaGate params (copied onto each clip on that track). */
  gate?: MultitrackGateParams;
  reaGateChunkBase64?: string;
  /** Track-level ReaComp params (copied onto each clip on that track). */
  comp?: MultitrackCompParams;
  reaCompChunkBase64?: string;
  /**
   * Absolute timeline seconds where this take is hard-muted (host ducking).
   * Applied as a volume gate during remake so one ffmpeg input covers the
   * whole take instead of hundreds of micro-clips.
   */
  muteSec?: Array<[number, number]>;
};

export type MultitrackManifest = {
  recordingEpochMs?: number;
  sessionStartedAtEpochMs?: number;
  segments?: MultitrackSegmentEntry[];
  [key: string]: unknown;
};

function resolveTrackPath(
  mtDir: string,
  entry: MultitrackSegmentEntry,
): string | null {
  const rel = entry.filePath;
  if (!rel || typeof rel !== "string") return null;
  const base = basename(rel.replace(/\\/g, "/"));
  const full = join(mtDir, base);
  return existsSync(full) ? full : null;
}

function clipPlayLengthMs(
  entry: MultitrackSegmentEntry,
  probedDurationMs: number | null,
): number | null {
  if (typeof entry.lengthMs === "number" && entry.lengthMs > 0) {
    return Math.round(entry.lengthMs);
  }
  const startMs = typeof entry.startMs === "number" ? entry.startMs : 0;
  if (typeof entry.endMs === "number" && entry.endMs > startMs) {
    return Math.round(entry.endMs - startMs);
  }
  if (probedDurationMs != null && probedDurationMs > 0) {
    const sourceOffsetMs =
      typeof entry.sourceOffsetMs === "number" && entry.sourceOffsetMs > 0
        ? Math.round(entry.sourceOffsetMs)
        : 0;
    return Math.max(0, Math.round(probedDurationMs - sourceOffsetMs));
  }
  return null;
}

/** Chain atempo filters; each factor must be in [0.5, 2]. */
function buildAtempoChain(rate: number): string[] {
  if (!Number.isFinite(rate) || rate <= 0 || Math.abs(rate - 1) < 0.0005) {
    return [];
  }
  const parts: string[] = [];
  let r = rate;
  while (r > 2) {
    parts.push("atempo=2.0");
    r /= 2;
  }
  while (r < 0.5) {
    parts.push("atempo=0.5");
    r /= 0.5;
  }
  if (Math.abs(r - 1) >= 0.0005) {
    parts.push(`atempo=${r.toFixed(6)}`);
  }
  return parts;
}

/**
 * Pitch shift in semitones without changing duration:
 * asetrate by ratio, aresample back, atempo compensate.
 */
function buildPitchParts(semitones: number): string[] {
  if (!Number.isFinite(semitones) || Math.abs(semitones) < 0.01) return [];
  const ratio = Math.pow(2, semitones / 12);
  const sr = 48000;
  return [
    `asetrate=${Math.round(sr * ratio)}`,
    `aresample=${sr}`,
    ...buildAtempoChain(1 / ratio),
  ];
}

/** Keep each enable= expression small; one huge between()+… AST OOMs ffmpeg. */
const MUTE_ENABLE_CHUNK = 16;

function normalizeMuteSec(muteSec: unknown): Array<[number, number]> {
  if (!Array.isArray(muteSec)) return [];
  return muteSec.filter(
    (r): r is [number, number] =>
      Array.isArray(r) &&
      r.length >= 2 &&
      typeof r[0] === "number" &&
      typeof r[1] === "number" &&
      Number.isFinite(r[0]) &&
      Number.isFinite(r[1]) &&
      r[1] > r[0],
  );
}

/** Host-ducking hard mutes as chained volume gates (timeline seconds, after adelay). */
function buildMuteVolumeParts(muteSec: unknown): string[] {
  const mutes = normalizeMuteSec(muteSec);
  if (mutes.length === 0) return [];
  const parts: string[] = [];
  for (let i = 0; i < mutes.length; i += MUTE_ENABLE_CHUNK) {
    const chunk = mutes.slice(i, i + MUTE_ENABLE_CHUNK);
    const enables = chunk
      .map(([s, e]) => `between(t\\,${s.toFixed(3)}\\,${e.toFixed(3)})`)
      .join("+");
    parts.push(`volume=0:enable='${enables}'`);
  }
  return parts;
}

function buildInputFilter(
  inputIdx: number,
  entry: MultitrackSegmentEntry,
  padDurationSec: string,
): string {
  const startMs = typeof entry.startMs === "number" ? entry.startMs : 0;
  const delayMs = Math.max(0, Math.round(startMs));
  const sourceOffsetMs =
    typeof entry.sourceOffsetMs === "number" && entry.sourceOffsetMs > 0
      ? Math.round(entry.sourceOffsetMs)
      : 0;
  const lengthMs =
    typeof entry.lengthMs === "number" && entry.lengthMs > 0
      ? Math.round(entry.lengthMs)
      : null;
  const playRate =
    typeof entry.playRate === "number" && entry.playRate > 0
      ? entry.playRate
      : 1;
  const preservePitch = entry.preservePitch !== false;
  const pitchSemis =
    typeof entry.pitchSemitones === "number" ? entry.pitchSemitones : 0;
  const loop = Boolean(entry.loop);
  const fadeInSec =
    typeof entry.fadeInSec === "number" && entry.fadeInSec > 0
      ? entry.fadeInSec
      : 0;
  const fadeOutSec =
    typeof entry.fadeOutSec === "number" && entry.fadeOutSec > 0
      ? entry.fadeOutSec
      : 0;

  const parts: string[] = [];

  // 1) Source trim (SOFFS / needed input for non-loop rate)
  const startSec = sourceOffsetMs / 1000;
  if (lengthMs != null && !loop) {
    const sourceNeededSec = (lengthMs / 1000) * playRate;
    const endSec = startSec + Math.max(0.001, sourceNeededSec);
    parts.push(
      `atrim=${startSec.toFixed(6)}:${endSec.toFixed(6)}`,
      "asetpts=PTS-STARTPTS",
    );
  } else if (sourceOffsetMs > 0 || loop) {
    parts.push(`atrim=start=${startSec.toFixed(6)}`, "asetpts=PTS-STARTPTS");
  }

  // 2) Pitch (preserve duration)
  parts.push(...buildPitchParts(pitchSemis));

  // 3) Play rate
  if (Math.abs(playRate - 1) >= 0.0005) {
    if (preservePitch) {
      parts.push(...buildAtempoChain(playRate));
    } else {
      const sr = 48000;
      parts.push(
        `asetrate=${Math.round(sr * playRate)}`,
        `aresample=${sr}`,
      );
    }
  }

  // 4) Loop then hard-trim to timeline length
  if (lengthMs != null && lengthMs > 0) {
    const lenSec = (lengthMs / 1000).toFixed(6);
    if (loop) {
      // Repeat enough to cover timeline length; size is per-loop sample estimate.
      // size=0: loop the whole decoded input buffer.
      parts.push(
        "aloop=loop=-1:size=0",
        `atrim=0:${lenSec}`,
        "asetpts=PTS-STARTPTS",
      );
    } else {
      parts.push(`atrim=0:${lenSec}`, "asetpts=PTS-STARTPTS");
    }
  }

  // 5) Fades
  if (fadeInSec > 0) {
    parts.push(`afade=t=in:st=0:d=${fadeInSec.toFixed(6)}`);
  }
  if (fadeOutSec > 0 && lengthMs != null && lengthMs > 0) {
    const st = Math.max(0, lengthMs / 1000 - fadeOutSec);
    parts.push(`afade=t=out:st=${st.toFixed(6)}:d=${fadeOutSec.toFixed(6)}`);
  }

  // 6) EQ then dynamics (gate → compressor)
  parts.push(...buildEqFilterParts(entry.eqBands));
  parts.push(...buildGateFilterParts(entry.gate));
  parts.push(...buildCompFilterParts(entry.comp));

  // 7) Place on timeline
  parts.push(`adelay=${delayMs}|${delayMs}`);
  parts.push(`apad=whole_dur=${padDurationSec}`);
  // 8) Host-ducking hard mutes (timeline seconds, after adelay)
  parts.push(...buildMuteVolumeParts(entry.muteSec));
  if (entry.volume != null && entry.volume !== 1) {
    parts.push(`volume=${entry.volume}`);
  }
  return `[${inputIdx}:a]${parts.join(",")}[a${inputIdx}]`;
}

/**
 * Remake the segment mix WAV from multitrack MP3s + tracks_manifest
 * (same loudnorm/amix rules as webrtc RecordingManager.runAmixAndDeliver).
 */
export async function remakeMixFromMultitrackDir(
  mtDir: string,
  manifest: MultitrackManifest,
  outWavPath: string,
  allowedBaseDir: string,
): Promise<{ durationSec: number }> {
  assertPathUnder(mtDir, allowedBaseDir);
  // Output may not exist yet; validate resolved path under allowed base.
  assertResolvedPathUnder(outWavPath, allowedBaseDir);
  const safeOut = resolve(outWavPath);
  mkdirSync(join(safeOut, ".."), { recursive: true });
  const segments = Array.isArray(manifest.segments) ? manifest.segments : [];
  if (segments.length === 0) {
    throw new Error("tracks_manifest has no segments to mix");
  }

  const usable = segments
    .map((s) => {
      if (s.muted === true) return null;
      if (typeof s.volume === "number" && s.volume <= 0) return null;
      const path = resolveTrackPath(mtDir, s);
      if (!path) return null;
      const size = statSync(path).size;
      if (size < MIN_SEGMENT_BYTES) return null;
      return { entry: s, path };
    })
    .filter(
      (x): x is { entry: MultitrackSegmentEntry; path: string } => x != null,
    );

  if (usable.length === 0) {
    throw new Error("No usable multitrack files to mix");
  }

  let recordingDurationMs = 0;
  for (const u of usable) {
    const startMs = typeof u.entry.startMs === "number" ? u.entry.startMs : 0;
    let probedMs: number | null = null;
    try {
      const probe = await audioService.probeAudio(u.path, allowedBaseDir);
      probedMs = Math.round(probe.durationSec * 1000);
    } catch {
      // ignore
    }
    const playLen = clipPlayLengthMs(u.entry, probedMs);
    if (playLen != null) {
      recordingDurationMs = Math.max(recordingDurationMs, startMs + playLen);
    } else if (typeof u.entry.endMs === "number" && u.entry.endMs > 0) {
      recordingDurationMs = Math.max(recordingDurationMs, u.entry.endMs);
    } else if (probedMs != null) {
      recordingDurationMs = Math.max(recordingDurationMs, startMs + probedMs);
    }
  }
  if (recordingDurationMs <= 0) {
    recordingDurationMs = 1000;
  }

  const filterParts: string[] = [];
  const inputArgs: string[] = [];
  let inputIdx = 0;
  for (const u of usable) {
    const startMs = typeof u.entry.startMs === "number" ? u.entry.startMs : 0;
    const delayMs = Math.max(0, Math.round(startMs));
    const padDurationMs = Math.max(0, recordingDurationMs - delayMs);
    const padDurationSec = (padDurationMs / 1000).toFixed(3);
    inputArgs.push("-i", u.path);
    filterParts.push(buildInputFilter(inputIdx, u.entry, padDurationSec));
    inputIdx++;
  }

  const loudnorm = `loudnorm=I=${SEGMENT_LOUDNESS_TARGET_LUFS}:TP=-1:LRA=14`;
  let filterComplex: string;
  if (inputIdx === 1) {
    filterComplex = `${filterParts[0]};[a0]${loudnorm}[out]`;
  } else {
    const amixInputs = Array.from({ length: inputIdx }, (_, i) => `[a${i}]`).join(
      "",
    );
    filterComplex =
      filterParts.join(";") +
      ";" +
      // normalize=0: sum like Reaper (default ffmpeg normalize divides by input count).
      `${amixInputs}amix=inputs=${inputIdx}:duration=longest:dropout_transition=500:normalize=0[aout];` +
      `[aout]${loudnorm}[out]`;
  }

  // Host-ducking graphs can exceed ARG_MAX if passed as -filter_complex.
  const filterScriptPath = join(
    tmpdir(),
    `harborfm-amix-${randomUUID()}.fffilter`,
  );
  writeFileSync(filterScriptPath, filterComplex, "utf8");
  try {
    await exec(
      FFMPEG_PATH,
      [
        "-loglevel",
        "warning",
        ...inputArgs,
        "-filter_complex_script",
        filterScriptPath,
        "-map",
        "[out]",
        "-acodec",
        "pcm_s16le",
        "-ar",
        "48000",
        "-ac",
        "1",
        "-y",
        safeOut,
      ],
      { maxBuffer: 16 * 1024 * 1024 },
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[multitrackRemake] ffmpeg mix failed", {
      mtDir,
      out: safeOut,
      inputs: usable.length,
      filterBytes: Buffer.byteLength(filterComplex, "utf8"),
      detail: detail.slice(0, 4000),
    });
    throw new Error("Failed to remake segment mix");
  } finally {
    try {
      unlinkSync(filterScriptPath);
    } catch {
      // best-effort
    }
  }

  if (!existsSync(safeOut) || statSync(safeOut).size <= 0) {
    throw new Error("ffmpeg mix produced empty output");
  }
  const probe = await audioService.probeAudio(safeOut, allowedBaseDir);
  return { durationSec: probe.durationSec };
}

/** Keep markers whose end time is within durationSec (soundbites use time+duration). */
export function pruneMarkersForDuration(
  markers: unknown,
  durationSec: number,
): unknown {
  if (!Array.isArray(markers)) return markers;
  const max = Math.max(0, durationSec);
  return markers.filter((m) => {
    if (!m || typeof m !== "object") return false;
    const time = Number((m as { time?: unknown }).time);
    if (!Number.isFinite(time) || time < 0 || time > max) return false;
    const dur = Number((m as { duration?: unknown }).duration);
    if (Number.isFinite(dur) && dur > 0) {
      return time + dur <= max;
    }
    return true;
  });
}
