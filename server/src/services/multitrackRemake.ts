import { execFile } from "child_process";
import { randomUUID } from "crypto";
import { promisify } from "util";
import { basename, join, resolve } from "path";
import {
  existsSync,
  mkdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "fs";
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

const MONO_48K = "aresample=48000,aformat=sample_fmts=fltp:channel_layouts=mono";

/** Clip processing without timeline placement (trim / rate / FX / volume). */
function buildClipBodyParts(entry: MultitrackSegmentEntry): string[] {
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

  parts.push(...buildPitchParts(pitchSemis));

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

  if (lengthMs != null && lengthMs > 0) {
    const lenSec = (lengthMs / 1000).toFixed(6);
    if (loop) {
      parts.push(
        "aloop=loop=-1:size=0",
        `atrim=0:${lenSec}`,
        "asetpts=PTS-STARTPTS",
      );
    } else {
      parts.push(`atrim=0:${lenSec}`, "asetpts=PTS-STARTPTS");
    }
  }

  if (fadeInSec > 0) {
    parts.push(`afade=t=in:st=0:d=${fadeInSec.toFixed(6)}`);
  }
  if (fadeOutSec > 0 && lengthMs != null && lengthMs > 0) {
    const st = Math.max(0, lengthMs / 1000 - fadeOutSec);
    parts.push(`afade=t=out:st=${st.toFixed(6)}:d=${fadeOutSec.toFixed(6)}`);
  }

  parts.push(...buildEqFilterParts(entry.eqBands));
  parts.push(...buildGateFilterParts(entry.gate));
  parts.push(...buildCompFilterParts(entry.comp));
  if (entry.volume != null && entry.volume !== 1) {
    parts.push(`volume=${entry.volume}`);
  }
  parts.push(MONO_48K);
  return parts;
}

/**
 * Legacy placement: adelay + apad to full timeline (fine for a few clips).
 * `sourceRef` is an ffmpeg pad without brackets (e.g. `0:a` or `sp0_3`).
 */
function buildDelayedClipFilter(
  sourceRef: string,
  outLabel: string,
  entry: MultitrackSegmentEntry,
  padDurationSec: string,
): string {
  const startMs = typeof entry.startMs === "number" ? entry.startMs : 0;
  const delayMs = Math.max(0, Math.round(startMs));
  const parts = buildClipBodyParts(entry);
  parts.push(`adelay=${delayMs}|${delayMs}`);
  parts.push(`apad=whole_dur=${padDurationSec}`);
  parts.push(...buildMuteVolumeParts(entry.muteSec));
  return `[${sourceRef}]${parts.join(",")}[${outLabel}]`;
}

function entryPlayLengthMs(
  entry: MultitrackSegmentEntry,
  probedMs: number | null,
): number {
  return clipPlayLengthMs(entry, probedMs) ?? 0;
}

function clipsOverlapOnTimeline(
  clips: Array<{ entry: MultitrackSegmentEntry }>,
  probedMs: number | null,
): boolean {
  const sorted = [...clips].sort(
    (a, b) => (a.entry.startMs ?? 0) - (b.entry.startMs ?? 0),
  );
  let end = 0;
  for (const c of sorted) {
    const startMs = Math.max(0, Math.round(c.entry.startMs ?? 0));
    const len = entryPlayLengthMs(c.entry, probedMs);
    if (len <= 0) continue;
    if (startMs < end - 1) return true;
    end = Math.max(end, startMs + len);
  }
  return false;
}

/** True when a clip needs per-clip graph FX (not expressible via concat demuxer seeks). */
function entryNeedsClipFx(entry: MultitrackSegmentEntry): boolean {
  if (typeof entry.volume === "number" && entry.volume !== 1) return true;
  if (typeof entry.playRate === "number" && entry.playRate > 0 && entry.playRate !== 1) {
    return true;
  }
  if (typeof entry.pitchSemitones === "number" && entry.pitchSemitones !== 0) {
    return true;
  }
  if (typeof entry.fadeInSec === "number" && entry.fadeInSec > 0) return true;
  if (typeof entry.fadeOutSec === "number" && entry.fadeOutSec > 0) return true;
  if (entry.loop) return true;
  if (Array.isArray(entry.eqBands) && entry.eqBands.length > 0) return true;
  if (entry.gate || entry.comp) return true;
  return false;
}

function ffconcatEscapePath(p: string): string {
  return p.replace(/'/g, "'\\''");
}

/**
 * Fast lane render for cut-only clips.
 * Decode the take once to PCM, then concat-demuxer inpoint/outpoint with
 * stream copy (MP3 seeks per clip are far too slow at Resolve clip counts).
 */
async function renderSeekConcatLane(opts: {
  sourcePath: string;
  clips: Array<{ entry: MultitrackSegmentEntry }>;
  probedMs: number | null;
}): Promise<{ lanePath: string; cleanup: () => void }> {
  const { sourcePath, clips, probedMs } = opts;
  const sorted = [...clips]
    .map((c) => ({
      entry: c.entry,
      startMs: Math.max(0, Math.round(c.entry.startMs ?? 0)),
      len: entryPlayLengthMs(c.entry, probedMs),
      sourceOffsetMs:
        typeof c.entry.sourceOffsetMs === "number" && c.entry.sourceOffsetMs > 0
          ? Math.round(c.entry.sourceOffsetMs)
          : 0,
    }))
    .filter((c) => c.len > 0)
    .sort((a, b) => a.startMs - b.startMs);

  const tmpId = randomUUID();
  const pcmPath = join(tmpdir(), `harborfm-pcm-${tmpId}.wav`);
  const silencePath = join(tmpdir(), `harborfm-sil-${tmpId}.wav`);
  const listPath = join(tmpdir(), `harborfm-ffconcat-${tmpId}.ffconcat`);
  const lanePath = join(tmpdir(), `harborfm-lane-${tmpId}.wav`);
  const cleanup = () => {
    for (const p of [pcmPath, silencePath, listPath, lanePath]) {
      try {
        unlinkSync(p);
      } catch {
        // best-effort
      }
    }
  };

  if (sorted.length === 0) {
    await exec(
      FFMPEG_PATH,
      [
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "anullsrc=r=48000:cl=mono",
        "-t",
        "0.05",
        "-c:a",
        "pcm_s16le",
        "-y",
        lanePath,
      ],
      { maxBuffer: 4 * 1024 * 1024 },
    );
    return { lanePath, cleanup };
  }

  // One decode of the take; later seeks are byte-accurate on PCM.
  await exec(
    FFMPEG_PATH,
    [
      "-loglevel",
      "error",
      "-i",
      sourcePath,
      "-vn",
      "-acodec",
      "pcm_s16le",
      "-ar",
      "48000",
      "-ac",
      "1",
      "-y",
      pcmPath,
    ],
    { maxBuffer: 16 * 1024 * 1024 },
  );

  // Short silence brick: concat demuxer ignores `duration` for PCM audio, so
  // gaps use repeated 1s bricks + outpoint for the remainder.
  const silenceBrickSec = 1;
  await exec(
    FFMPEG_PATH,
    [
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "anullsrc=r=48000:cl=mono",
      "-t",
      String(silenceBrickSec),
      "-c:a",
      "pcm_s16le",
      "-y",
      silencePath,
    ],
    { maxBuffer: 4 * 1024 * 1024 },
  );

  const lines = ["ffconcat version 1.0"];
  let cursorMs = 0;
  const sil = ffconcatEscapePath(silencePath);
  const src = ffconcatEscapePath(pcmPath);
  const pushSilence = (gapSec: number) => {
    if (gapSec <= 0) return;
    let remaining = gapSec;
    while (remaining > silenceBrickSec + 0.0005) {
      lines.push(`file '${sil}'`);
      remaining -= silenceBrickSec;
    }
    if (remaining > 0.0005) {
      lines.push(`file '${sil}'`);
      lines.push("inpoint 0");
      lines.push(`outpoint ${remaining.toFixed(6)}`);
    }
  };
  for (const c of sorted) {
    if (c.startMs > cursorMs) {
      pushSilence((c.startMs - cursorMs) / 1000);
    }
    const inpoint = c.sourceOffsetMs / 1000;
    const outpoint = inpoint + c.len / 1000;
    lines.push(`file '${src}'`);
    lines.push(`inpoint ${inpoint.toFixed(6)}`);
    lines.push(`outpoint ${outpoint.toFixed(6)}`);
    cursorMs = Math.max(cursorMs, c.startMs + c.len);
  }
  writeFileSync(listPath, `${lines.join("\n")}\n`);

  // Same PCM layout for silence + source slices: stream-copy the lane.
  await exec(
    FFMPEG_PATH,
    [
      "-loglevel",
      "error",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listPath,
      "-c",
      "copy",
      "-y",
      lanePath,
    ],
    { maxBuffer: 16 * 1024 * 1024 },
  );

  return { lanePath, cleanup };
}

/**
 * Build one media-file lane: silence gaps + trimmed clips concatenated.
 * Avoids amixing hundreds of full-duration padded streams (Resolve OTIO).
 */
function buildConcatLaneFilters(
  inputIdx: number,
  clips: Array<{ entry: MultitrackSegmentEntry }>,
  probedMs: number | null,
  totalDurationMs: number,
  laneLabel: string,
): string[] {
  const sorted = [...clips]
    .map((c) => ({
      entry: c.entry,
      startMs: Math.max(0, Math.round(c.entry.startMs ?? 0)),
      len: entryPlayLengthMs(c.entry, probedMs),
    }))
    .filter((c) => c.len > 0)
    .sort((a, b) => a.startMs - b.startMs);
  const n = sorted.length;
  if (n === 0) return [];

  const parts: string[] = [];
  const pads =
    n > 1
      ? Array.from({ length: n }, (_, i) => `sp${inputIdx}_${i}`)
      : null;
  if (pads) {
    parts.push(
      `[${inputIdx}:a]asplit=${n}${pads.map((p) => `[${p}]`).join("")}`,
    );
  }

  const concatPads: string[] = [];
  let cursorMs = 0;
  let silenceIdx = 0;
  const muteRanges: Array<[number, number]> = [];

  for (let i = 0; i < n; i++) {
    const { entry, startMs, len } = sorted[i]!;

    if (startMs > cursorMs) {
      const gapSec = ((startMs - cursorMs) / 1000).toFixed(6);
      const gLabel = `g${inputIdx}_${silenceIdx++}`;
      parts.push(
        `aevalsrc=0:d=${gapSec}:s=48000,aformat=sample_fmts=fltp:channel_layouts=mono[${gLabel}]`,
      );
      concatPads.push(`[${gLabel}]`);
    }

    const srcRef = pads ? pads[i]! : `${inputIdx}:a`;
    const cLabel = `c${inputIdx}_${i}`;
    const body = buildClipBodyParts(entry);
    parts.push(`[${srcRef}]${body.join(",")}[${cLabel}]`);
    concatPads.push(`[${cLabel}]`);
    cursorMs = Math.max(cursorMs, startMs + len);
    muteRanges.push(...normalizeMuteSec(entry.muteSec));
  }

  if (cursorMs < totalDurationMs) {
    const gapSec = ((totalDurationMs - cursorMs) / 1000).toFixed(6);
    const gLabel = `g${inputIdx}_${silenceIdx++}`;
    parts.push(
      `aevalsrc=0:d=${gapSec}:s=48000,aformat=sample_fmts=fltp:channel_layouts=mono[${gLabel}]`,
    );
    concatPads.push(`[${gLabel}]`);
  }

  if (concatPads.length === 0) {
    const gLabel = `g${inputIdx}_empty`;
    const durSec = (Math.max(1, totalDurationMs) / 1000).toFixed(6);
    parts.push(
      `aevalsrc=0:d=${durSec}:s=48000,aformat=sample_fmts=fltp:channel_layouts=mono[${gLabel}]`,
    );
    concatPads.push(`[${gLabel}]`);
  }

  const muteParts = buildMuteVolumeParts(muteRanges);
  if (concatPads.length === 1 && muteParts.length === 0) {
    parts.push(`${concatPads[0]}acopy[${laneLabel}]`);
  } else if (concatPads.length === 1) {
    parts.push(`${concatPads[0]}${muteParts.join(",")}[${laneLabel}]`);
  } else {
    const concat = `${concatPads.join("")}concat=n=${concatPads.length}:v=0:a=1`;
    if (muteParts.length === 0) {
      parts.push(`${concat}[${laneLabel}]`);
    } else {
      parts.push(`${concat},${muteParts.join(",")}[${laneLabel}]`);
    }
  }
  return parts;
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

  // Probe each unique media file once (Resolve OTIO can yield hundreds of clips
  // from a handful of takes).
  const probedMsByPath = new Map<string, number | null>();
  for (const u of usable) {
    if (probedMsByPath.has(u.path)) continue;
    try {
      const probe = await audioService.probeAudio(u.path, allowedBaseDir);
      probedMsByPath.set(u.path, Math.round(probe.durationSec * 1000));
    } catch {
      probedMsByPath.set(u.path, null);
    }
  }

  let recordingDurationMs = 0;
  for (const u of usable) {
    const startMs = typeof u.entry.startMs === "number" ? u.entry.startMs : 0;
    const probedMs = probedMsByPath.get(u.path) ?? null;
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

  // One ffmpeg -i per unique media file.
  const inputArgs: string[] = [];
  const pathToInputIdx = new Map<string, number>();
  const clipsByPath = new Map<
    string,
    Array<{ entry: MultitrackSegmentEntry; path: string }>
  >();
  for (const u of usable) {
    if (!pathToInputIdx.has(u.path)) {
      pathToInputIdx.set(u.path, pathToInputIdx.size);
      inputArgs.push("-i", u.path);
    }
    const list = clipsByPath.get(u.path) ?? [];
    list.push(u);
    clipsByPath.set(u.path, list);
  }

  // Prefer seek-concat lanes when many non-overlapping cut-only slices share a
  // few takes (typical Resolve OTIO). Overlaps / clip FX fall back to graph mix.
  let useSeekConcatLanes = usable.length > 16;
  if (useSeekConcatLanes) {
    for (const [path, clips] of clipsByPath) {
      const probed = probedMsByPath.get(path) ?? null;
      if (clipsOverlapOnTimeline(clips, probed)) {
        useSeekConcatLanes = false;
        break;
      }
      if (clips.some((c) => entryNeedsClipFx(c.entry))) {
        useSeekConcatLanes = false;
        break;
      }
    }
  }

  const loudnorm = `loudnorm=I=${SEGMENT_LOUDNESS_TARGET_LUFS}:TP=-1:LRA=14`;
  const laneCleanups: Array<() => void> = [];

  try {
    if (useSeekConcatLanes) {
      // Render one lane WAV per media file (parallel), then amix + loudnorm.
      const laneJobs = [...clipsByPath.entries()].map(async ([path, clips]) => {
        const rendered = await renderSeekConcatLane({
          sourcePath: path,
          clips,
          probedMs: probedMsByPath.get(path) ?? null,
        });
        const muteRanges = clips.flatMap((c) =>
          normalizeMuteSec(c.entry.muteSec),
        );
        return {
          lanePath: rendered.lanePath,
          muteRanges,
          cleanup: rendered.cleanup,
        };
      });
      const lanes = await Promise.all(laneJobs);
      for (const lane of lanes) {
        laneCleanups.push(lane.cleanup);
      }

      const laneInputArgs: string[] = [];
      for (const lane of lanes) {
        laneInputArgs.push("-i", lane.lanePath);
      }

      const filterParts: string[] = [];
      const mixLabels: string[] = [];
      for (let i = 0; i < lanes.length; i++) {
        const muteParts = buildMuteVolumeParts(lanes[i]!.muteRanges);
        const label = `lane${i}`;
        if (muteParts.length === 0) {
          filterParts.push(`[${i}:a]anull[${label}]`);
        } else {
          filterParts.push(`[${i}:a]${muteParts.join(",")}[${label}]`);
        }
        mixLabels.push(label);
      }

      let filterComplex: string;
      if (mixLabels.length === 1) {
        filterComplex = `${filterParts.join(";")};[${mixLabels[0]}]${loudnorm}[out]`;
      } else {
        const amixInputs = mixLabels.map((l) => `[${l}]`).join("");
        filterComplex =
          filterParts.join(";") +
          ";" +
          `${amixInputs}amix=inputs=${mixLabels.length}:duration=longest:dropout_transition=500:normalize=0[aout];` +
          `[aout]${loudnorm}[out]`;
      }

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
            ...laneInputArgs,
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
          clips: usable.length,
          mediaFiles: pathToInputIdx.size,
          mixLanes: mixLabels.length,
          mode: "seek-concat-lanes",
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
    } else {
      // Graph path: adelay+apad per clip (or filter concat for moderate graphs).
      const filterParts: string[] = [];
      const mixLabels: string[] = [];
      let useFilterConcatLanes = usable.length > 16;
      if (useFilterConcatLanes) {
        for (const [path, clips] of clipsByPath) {
          if (clipsOverlapOnTimeline(clips, probedMsByPath.get(path) ?? null)) {
            useFilterConcatLanes = false;
            break;
          }
        }
      }

      if (useFilterConcatLanes) {
        for (const [path, clips] of clipsByPath) {
          const inIdx = pathToInputIdx.get(path)!;
          const laneLabel = `lane${inIdx}`;
          filterParts.push(
            ...buildConcatLaneFilters(
              inIdx,
              clips,
              probedMsByPath.get(path) ?? null,
              recordingDurationMs,
              laneLabel,
            ),
          );
          mixLabels.push(laneLabel);
        }
      } else {
        const pathClipCount = new Map<string, number>();
        for (const u of usable) {
          pathClipCount.set(u.path, (pathClipCount.get(u.path) ?? 0) + 1);
        }
        const splitPadsByPath = new Map<string, string[]>();
        for (const [path, count] of pathClipCount) {
          if (count <= 1) continue;
          const inIdx = pathToInputIdx.get(path)!;
          const pads = Array.from(
            { length: count },
            (_, i) => `sp${inIdx}_${i}`,
          );
          filterParts.push(
            `[${inIdx}:a]asplit=${count}${pads.map((p) => `[${p}]`).join("")}`,
          );
          splitPadsByPath.set(path, pads);
        }

        const splitUseByPath = new Map<string, number>();
        let outIdx = 0;
        for (const u of usable) {
          const startMs =
            typeof u.entry.startMs === "number" ? u.entry.startMs : 0;
          const delayMs = Math.max(0, Math.round(startMs));
          const padDurationMs = Math.max(0, recordingDurationMs - delayMs);
          const padDurationSec = (padDurationMs / 1000).toFixed(3);
          const inIdx = pathToInputIdx.get(u.path)!;
          const count = pathClipCount.get(u.path) ?? 1;
          let sourceRef: string;
          if (count <= 1) {
            sourceRef = `${inIdx}:a`;
          } else {
            const used = splitUseByPath.get(u.path) ?? 0;
            splitUseByPath.set(u.path, used + 1);
            sourceRef = splitPadsByPath.get(u.path)![used]!;
          }
          const outLabel = `a${outIdx}`;
          filterParts.push(
            buildDelayedClipFilter(
              sourceRef,
              outLabel,
              u.entry,
              padDurationSec,
            ),
          );
          mixLabels.push(outLabel);
          outIdx++;
        }
      }

      let filterComplex: string;
      if (mixLabels.length === 1) {
        filterComplex = `${filterParts.join(";")};[${mixLabels[0]}]${loudnorm}[out]`;
      } else {
        const amixInputs = mixLabels.map((l) => `[${l}]`).join("");
        filterComplex =
          filterParts.join(";") +
          ";" +
          `${amixInputs}amix=inputs=${mixLabels.length}:duration=longest:dropout_transition=500:normalize=0[aout];` +
          `[aout]${loudnorm}[out]`;
      }

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
          clips: usable.length,
          mediaFiles: pathToInputIdx.size,
          mixLanes: mixLabels.length,
          mode: useFilterConcatLanes ? "filter-concat-lanes" : "adelay-amix",
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
    }
  } finally {
    for (const cleanup of laneCleanups) {
      try {
        cleanup();
      } catch {
        // best-effort
      }
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

/**
 * Drop trim ranges entirely past durationSec; clamp ranges that straddle the end.
 * Preserves in-bounds HarborFM trims when a remake shortens the mix.
 */
export function pruneTrimRangesForDuration(
  trimRanges: unknown,
  durationSec: number,
): Array<[number, number]> {
  if (!Array.isArray(trimRanges)) return [];
  const max = Math.max(0, durationSec);
  const out: Array<[number, number]> = [];
  for (const raw of trimRanges) {
    if (!Array.isArray(raw) || raw.length < 2) continue;
    const start = Number(raw[0]);
    const end = Number(raw[1]);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (start >= max) continue;
    const clampedStart = Math.max(0, start);
    const clampedEnd = Math.min(max, end);
    if (clampedEnd <= clampedStart) continue;
    out.push([clampedStart, clampedEnd]);
  }
  return out;
}
