import { createRequire } from "module";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "fs";
import { basename, extname, join, resolve, sep } from "path";
import { nanoid } from "nanoid";
import {
  assertPathUnder,
  assertResolvedPathUnder,
} from "../../services/paths.js";
import type {
  MultitrackCompParams,
  MultitrackEqBand,
  MultitrackGateParams,
  MultitrackManifest,
  MultitrackSegmentEntry,
} from "../../services/multitrackRemake.js";
import { sha256FileSync } from "../../utils/hash.js";
import { ImportValidationError } from "./projectSegmentShared.js";
import { isAudioFilename } from "./projectDawSidecars.js";
import {
  decodeReaCompBase64,
  decodeReaGateBase64,
  joinVstStateChunks,
} from "./projectReaperDynamics.js";
import { decodeReaEqBase64 } from "./projectReaperEq.js";

const require = createRequire(import.meta.url);
/** Use parse (not specialize) so ReaEQ VST b64Chunks stay as base64 strings. */
const rppp = require("rppp") as {
  parse: (text: string) => TimelineNode;
};

type TimelineNode = {
  token: string;
  params?: (string | number)[];
  contents?: TimelineNode[];
  b64Chunks?: unknown[];
  getStructByToken?: (token: string, index?: number) => TimelineNode | undefined;
};

const TIMELINE_SIDECAR_NAME = "segment.rpp";

/**
 * Reaper on Windows writes `\` in FILE / ORIGINAL_FILENAME paths. The RPP
 * parser rejects those characters, so normalize to `/` before parse.
 */
export function normalizeRppTextForParse(text: string): string {
  return text.replace(/\\/g, "/");
}

function readStructParam(
  node: TimelineNode | undefined,
  index = 0,
): string | number | undefined {
  if (!node || !Array.isArray(node.params) || node.params.length <= index) {
    return undefined;
  }
  return node.params[index];
}

function readNonNegSec(node: TimelineNode | undefined): number | null {
  const raw = readStructParam(node);
  const n =
    typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function getChildStruct(node: TimelineNode, token: string): TimelineNode | undefined {
  if (typeof node.getStructByToken === "function") {
    return node.getStructByToken(token);
  }
  return (node.contents ?? []).find((c) => c.token === token);
}

function readTrackName(track: TimelineNode): string {
  const raw = readStructParam(getChildStruct(track, "NAME"));
  return typeof raw === "string" && raw.trim() ? raw.trim() : "track";
}

/** Reaper VOLPAN first param is linear amplitude (1 = 0 dB). */
function readVolpanGain(node: TimelineNode): number {
  const raw = readStructParam(getChildStruct(node, "VOLPAN"), 0);
  const n =
    typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n < 0) return 1;
  return n;
}

function isTruthyFlag(raw: string | number | undefined): boolean {
  if (typeof raw === "number") return raw === 1;
  if (typeof raw === "string") return Number(raw) === 1;
  return false;
}

/** TRACK MUTESOLO first param, or ITEM MUTE first param. */
function isMuted(node: TimelineNode, token: "MUTESOLO" | "MUTE"): boolean {
  return isTruthyFlag(readStructParam(getChildStruct(node, token), 0));
}

/**
 * Track fader × item gain (linear), plus mute flag.
 * Volume is kept even when muted so export can restore the fader position.
 */
function readClipVolumeState(
  track: TimelineNode,
  item: TimelineNode,
): { volume: number; muted: boolean } {
  const muted = isMuted(track, "MUTESOLO") || isMuted(item, "MUTE");
  const volume = readVolpanGain(track) * readVolpanGain(item);
  return { volume, muted };
}

function readNumberParam(
  node: TimelineNode | undefined,
  index: number,
): number | null {
  const raw = readStructParam(node, index);
  const n =
    typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Item PLAYRATE / fades / LOOP from a Reaper ITEM node. */
function readItemPlayback(item: TimelineNode): {
  playRate?: number;
  preservePitch?: boolean;
  pitchSemitones?: number;
  fadeInSec?: number;
  fadeOutSec?: number;
  loop?: boolean;
} {
  const out: {
    playRate?: number;
    preservePitch?: boolean;
    pitchSemitones?: number;
    fadeInSec?: number;
    fadeOutSec?: number;
    loop?: boolean;
  } = {};

  const rate = readNumberParam(getChildStruct(item, "PLAYRATE"), 0);
  if (rate != null && rate > 0 && rate !== 1) out.playRate = rate;
  const preserve = readNumberParam(getChildStruct(item, "PLAYRATE"), 1);
  if (preserve != null) out.preservePitch = preserve !== 0;
  else if (out.playRate != null) out.preservePitch = true;
  const pitch = readNumberParam(getChildStruct(item, "PLAYRATE"), 2);
  if (pitch != null && pitch !== 0) out.pitchSemitones = pitch;

  const fadeIn = readNumberParam(getChildStruct(item, "FADEIN"), 1);
  if (fadeIn != null && fadeIn > 0) out.fadeInSec = fadeIn;
  const fadeOut = readNumberParam(getChildStruct(item, "FADEOUT"), 1);
  if (fadeOut != null && fadeOut > 0) out.fadeOutSec = fadeOut;

  const loop = readNumberParam(getChildStruct(item, "LOOP"), 0);
  if (loop === 1) out.loop = true;

  return out;
}

type TrackFxFields = {
  eqBands?: MultitrackEqBand[];
  reaEqChunkBase64?: string;
  gate?: MultitrackGateParams;
  reaGateChunkBase64?: string;
  comp?: MultitrackCompParams;
  reaCompChunkBase64?: string;
};

/**
 * Walk track FXCHAIN with per-plugin BYPASS (sibling before each VST).
 * Only non-bypassed plugins contribute remake fields + raw chunks.
 */
function readTrackFx(track: TimelineNode): TrackFxFields {
  const fxchain = getChildStruct(track, "FXCHAIN");
  if (!fxchain) return {};

  const out: TrackFxFields = {};
  let pendingBypass = false;

  for (const node of fxchain.contents ?? []) {
    if (node.token === "BYPASS") {
      pendingBypass = readNumberParam(node, 0) === 1;
      continue;
    }
    if (node.token !== "VST") continue;
    const bypassed = pendingBypass;
    pendingBypass = false;
    if (bypassed) continue;

    const name = String(readStructParam(node, 0) ?? "");
    const dll = String(readStructParam(node, 1) ?? "");
    const b64 = joinVstStateChunks(node.b64Chunks ?? []);
    if (!b64) continue;

    const isReaEq =
      /reaeq/i.test(name) || /reaeq\.dll/i.test(dll) || /ReaEQ/i.test(name);
    const isReaGate =
      /reagate/i.test(name) ||
      /reagate\.dll/i.test(dll) ||
      /ReaGate/i.test(name);
    const isReaComp =
      /reacomp/i.test(name) ||
      /reacomp\.dll/i.test(dll) ||
      /ReaComp/i.test(name);

    if (isReaEq && !out.eqBands) {
      const bands = decodeReaEqBase64(b64);
      if (bands) {
        out.eqBands = bands;
        out.reaEqChunkBase64 = b64;
      } else {
        console.warn("[projectImport] Failed to decode ReaEQ chunk on track");
      }
      continue;
    }
    if (isReaGate && !out.gate) {
      const gate = decodeReaGateBase64(b64);
      if (gate) {
        out.gate = gate;
        out.reaGateChunkBase64 = b64;
      } else {
        console.warn("[projectImport] Failed to decode ReaGate chunk on track");
        out.reaGateChunkBase64 = b64;
      }
      continue;
    }
    if (isReaComp && !out.comp) {
      const comp = decodeReaCompBase64(b64);
      if (comp) {
        out.comp = comp;
        out.reaCompChunkBase64 = b64;
      } else {
        console.warn("[projectImport] Failed to decode ReaComp chunk on track");
        out.reaCompChunkBase64 = b64;
      }
    }
  }
  return out;
}

function findMediaFilePath(item: TimelineNode): string | null {
  const stack: TimelineNode[] = [...(item.contents ?? [])];
  while (stack.length > 0) {
    const node = stack.shift()!;
    if (node.token === "FILE") {
      const p = readStructParam(node);
      if (typeof p === "string" && p.trim()) return p.trim();
    }
    if (Array.isArray(node.contents) && node.contents.length > 0) {
      stack.push(...node.contents);
    }
  }
  return null;
}

/**
 * Resolve a relative media path under the segment folder.
 * Rejects absolute paths and any `..` escape.
 * When `allowMissing` is true, returns null if the file is absent
 * (path validation errors still throw).
 */
export function resolveMediaPathUnderSegment(
  segDir: string,
  mediaPath: string,
  opts?: { allowMissing?: boolean },
): string | null {
  const normalized = mediaPath.replace(/\\/g, "/").trim();
  if (!normalized) {
    throw new ImportValidationError(
      "segment.rpp has an empty media path on a clip. Point the clip at a file under the segment folder and save again.",
    );
  }
  if (
    normalized.startsWith("/") ||
    normalized.startsWith("~") ||
    /^[a-zA-Z]:[\\/]/.test(normalized)
  ) {
    throw new ImportValidationError(
      `segment.rpp points at an absolute path (${normalized}). ` +
        "Move the audio into the segment folder (for example Media/yourfile.mp3 " +
        "next to segment.rpp), set the clip to that relative path in Reaper, " +
        "save, re-zip, and import again.",
    );
  }
  const parts = normalized.split("/").filter((p) => p.length > 0);
  if (parts.some((p) => p === "..")) {
    throw new ImportValidationError(
      `segment.rpp media path leaves the segment folder (${normalized}). ` +
        "Keep clips under the segment folder (no ..), save, re-zip, and import again.",
    );
  }
  const abs = resolve(join(segDir, ...parts.filter((p) => p !== ".")));
  const base = resolve(segDir);
  if (abs !== base && !abs.startsWith(base + sep)) {
    throw new ImportValidationError(
      `segment.rpp media path leaves the segment folder (${normalized}). ` +
        "Keep clips under the segment folder, save, re-zip, and import again.",
    );
  }
  assertResolvedPathUnder(abs, segDir);
  if (!existsSync(abs)) {
    if (opts?.allowMissing) return null;
    throw new ImportValidationError(
      `segment.rpp references missing audio: ${normalized}. ` +
        "Copy that file into the segment folder (next to segment.rpp) so the " +
        "zip includes it, then import again.",
    );
  }
  return assertPathUnder(abs, segDir);
}

function uniqueBasenameInDir(dir: string, preferred: string): string {
  const safe = basename(preferred.replace(/\\/g, "/"));
  if (!safe || safe === "." || safe === "..") {
    return `track_${nanoid()}.mp3`;
  }
  if (!existsSync(join(dir, safe))) return safe;
  const ext = extname(safe);
  const stem = safe.slice(0, safe.length - ext.length) || "track";
  for (let i = 2; i < 10_000; i++) {
    const candidate = `${stem}_${i}${ext}`;
    if (!existsSync(join(dir, candidate))) return candidate;
  }
  return `${stem}_${nanoid()}${ext}`;
}

function copyMediaBytes(
  mediaAbs: string,
  mtDest: string,
): { basename: string; bytesAdded: number } {
  mkdirSync(mtDest, { recursive: true });
  const preferred = basename(mediaAbs);
  const mtResolved = resolve(mtDest);
  const mediaResolved = resolve(mediaAbs);

  if (
    mediaResolved === mtResolved ||
    mediaResolved.startsWith(mtResolved + sep)
  ) {
    return { basename: preferred, bytesAdded: 0 };
  }

  // Already copied from zip recordings/ into mtDest under the same basename.
  const existing = join(mtDest, preferred);
  if (existsSync(existing)) {
    return { basename: preferred, bytesAdded: 0 };
  }

  const destName = uniqueBasenameInDir(mtDest, preferred);
  const destAbs = join(mtDest, destName);
  copyFileSync(mediaAbs, destAbs);
  return { basename: destName, bytesAdded: statSync(destAbs).size };
}

function mediaStem(basename: string): string {
  return basename.replace(/\.[^.]+$/, "") || basename;
}

function findPriorManifestEntry(
  existingManifest: MultitrackManifest | null,
  mediaBasename: string,
): MultitrackSegmentEntry | null {
  const segments = existingManifest?.segments;
  if (!Array.isArray(segments)) return null;
  const want = mediaBasename.replace(/\\/g, "/");
  for (const entry of segments) {
    const rel = typeof entry.filePath === "string" ? entry.filePath : null;
    if (!rel) continue;
    if (basename(rel.replace(/\\/g, "/")) === want) return entry;
  }
  return null;
}

/** HarborFM export participant lanes look like Host_0 / Logan_1. */
function isHarborParticipantLaneName(trackName: string): boolean {
  return /^.+_\d+$/.test(trackName.trim());
}

/**
 * Classify a Reaper track: keep known participant/soundboard identity from the
 * prior manifest or HarborFM lane names; treat newly added Reaper tracks (music,
 * etc.) as library/soundboard so they sort under host lanes on re-export.
 */
function classifyReaperTrack(
  trackName: string,
  mediaBasename: string,
  existingManifest: MultitrackManifest | null,
): Pick<
  MultitrackSegmentEntry,
  "source" | "participantName" | "participantId" | "soundboardAssetId"
> {
  const prior = findPriorManifestEntry(existingManifest, mediaBasename);
  if (prior) {
    if (prior.source === "soundboard") {
      return {
        source: "soundboard",
        soundboardAssetId:
          (typeof prior.soundboardAssetId === "string" &&
            prior.soundboardAssetId.trim()) ||
          mediaStem(mediaBasename),
        participantName: null,
        participantId: null,
      };
    }
    return {
      source: typeof prior.source === "string" ? prior.source : null,
      participantName:
        (typeof prior.participantName === "string" &&
          prior.participantName.trim()) ||
        trackName,
      participantId:
        typeof prior.participantId === "string" ? prior.participantId : null,
      soundboardAssetId: null,
    };
  }

  if (trackName.startsWith("soundboard_")) {
    return {
      source: "soundboard",
      soundboardAssetId:
        trackName.slice("soundboard_".length).trim() ||
        mediaStem(mediaBasename),
      participantName: null,
      participantId: null,
    };
  }

  if (isHarborParticipantLaneName(trackName)) {
    return {
      participantName: trackName,
      participantId: null,
      soundboardAssetId: null,
    };
  }

  // New track added in Reaper (not a HarborFM host lane): library-style.
  return {
    source: "soundboard",
    soundboardAssetId: trackName.trim() || mediaStem(mediaBasename),
    participantName: null,
    participantId: null,
  };
}

function entryFromClip(opts: {
  trackName: string;
  mediaBasename: string;
  startSec: number;
  lengthSec: number | null;
  sourceOffsetSec: number;
  /** Linear amplitude; omitted from manifest when unity (1). */
  volume?: number;
  muted?: boolean;
  existingManifest: MultitrackManifest | null;
  playRate?: number;
  preservePitch?: boolean;
  pitchSemitones?: number;
  fadeInSec?: number;
  fadeOutSec?: number;
  loop?: boolean;
  eqBands?: MultitrackEqBand[];
  reaEqChunkBase64?: string;
  gate?: MultitrackGateParams;
  reaGateChunkBase64?: string;
  comp?: MultitrackCompParams;
  reaCompChunkBase64?: string;
}): MultitrackSegmentEntry {
  const startMs = Math.round(opts.startSec * 1000);
  const sourceOffsetMs = Math.round(opts.sourceOffsetSec * 1000);
  const lengthMs =
    opts.lengthSec != null ? Math.round(opts.lengthSec * 1000) : undefined;
  const endMs =
    lengthMs != null && lengthMs > 0 ? startMs + lengthMs : undefined;

  const classified = classifyReaperTrack(
    opts.trackName,
    opts.mediaBasename,
    opts.existingManifest,
  );

  const entry: MultitrackSegmentEntry = {
    segmentId: nanoid(),
    startMs,
    filePath: opts.mediaBasename,
  };
  if (classified.participantName) {
    entry.participantName = classified.participantName;
  }
  if (classified.participantId) {
    entry.participantId = classified.participantId;
  }
  if (classified.source) {
    entry.source = classified.source;
  }
  if (classified.soundboardAssetId) {
    entry.soundboardAssetId = classified.soundboardAssetId;
  }
  if (sourceOffsetMs > 0) entry.sourceOffsetMs = sourceOffsetMs;
  if (lengthMs != null && lengthMs > 0) entry.lengthMs = lengthMs;
  if (endMs != null) entry.endMs = endMs;
  if (opts.volume != null && opts.volume !== 1) {
    entry.volume = opts.volume;
  }
  if (opts.muted) entry.muted = true;
  if (opts.playRate != null && opts.playRate > 0 && opts.playRate !== 1) {
    entry.playRate = opts.playRate;
  }
  if (opts.preservePitch != null) entry.preservePitch = opts.preservePitch;
  if (opts.pitchSemitones != null && opts.pitchSemitones !== 0) {
    entry.pitchSemitones = opts.pitchSemitones;
  }
  if (opts.fadeInSec != null && opts.fadeInSec > 0) {
    entry.fadeInSec = opts.fadeInSec;
  }
  if (opts.fadeOutSec != null && opts.fadeOutSec > 0) {
    entry.fadeOutSec = opts.fadeOutSec;
  }
  if (opts.loop) entry.loop = true;
  if (opts.eqBands && opts.eqBands.length > 0) {
    entry.eqBands = opts.eqBands;
  }
  if (opts.reaEqChunkBase64) {
    entry.reaEqChunkBase64 = opts.reaEqChunkBase64;
  }
  if (opts.gate) entry.gate = opts.gate;
  if (opts.reaGateChunkBase64) {
    entry.reaGateChunkBase64 = opts.reaGateChunkBase64;
  }
  if (opts.comp) entry.comp = opts.comp;
  if (opts.reaCompChunkBase64) {
    entry.reaCompChunkBase64 = opts.reaCompChunkBase64;
  }
  return entry;
}

/** True when the timeline sidecar exists and its hash differs from the stored export hash. */
export function timelineSidecarNeedsApply(
  segDir: string,
  storedHash: string | null | undefined,
): boolean {
  const path = join(segDir, TIMELINE_SIDECAR_NAME);
  if (!existsSync(path)) return false;
  const current = sha256FileSync(path);
  if (!current) return false;
  if (typeof storedHash !== "string" || !storedHash) return true;
  return current !== storedHash;
}

export type ApplyTimelineResult =
  | { ok: true; manifest: MultitrackManifest; bytesAdded: number }
  | { ok: false; error: string };

const REAPER_READ_ERROR = "There was an error reading the Reaper file.";

/** User-facing notice when import falls back after an unreadable segment.rpp. */
export const REAPER_IGNORED_WARNING =
  "There was an error reading the Reaper file. It was ignored.";

/**
 * Parse the segment timeline sidecar, rebuild tracks_manifest segments from
 * its clips, and copy referenced media into the multitrack dir when needed.
 * Unreadable Reaper files return `{ ok: false }` so import can fall back to
 * the existing tracks_manifest.json.
 */
export function applyTimelineSidecarToManifest(opts: {
  segDir: string;
  mtDest: string;
  existingManifest: MultitrackManifest | null;
  /** When true, clips whose media file is missing are skipped (Import Reaper). */
  skipMissingMedia?: boolean;
}): ApplyTimelineResult {
  const { segDir, mtDest, existingManifest, skipMissingMedia } = opts;
  const sidecarPath = join(segDir, TIMELINE_SIDECAR_NAME);
  if (!existsSync(sidecarPath)) {
    throw new ImportValidationError("Timeline sidecar is missing");
  }
  assertPathUnder(sidecarPath, segDir);
  mkdirSync(mtDest, { recursive: true });

  let root: TimelineNode;
  try {
    const text = normalizeRppTextForParse(readFileSync(sidecarPath, "utf8"));
    root = rppp.parse(text);
  } catch (err) {
    if (err instanceof ImportValidationError) throw err;
    return { ok: false, error: REAPER_READ_ERROR };
  }

  if (root.token !== "REAPER_PROJECT") {
    return { ok: false, error: REAPER_READ_ERROR };
  }

  const segments: MultitrackSegmentEntry[] = [];
  let bytesAdded = 0;
  const tracks = (root.contents ?? []).filter((c) => c.token === "TRACK");

  for (const track of tracks) {
    const trackName = readTrackName(track);
    const trackFx = readTrackFx(track);
    const items = (track.contents ?? []).filter((c) => c.token === "ITEM");
    for (const item of items) {
      const mediaRel = findMediaFilePath(item);
      if (!mediaRel) continue;
      const mediaAbs = resolveMediaPathUnderSegment(segDir, mediaRel, {
        allowMissing: Boolean(skipMissingMedia),
      });
      if (!mediaAbs) {
        console.warn(
          `[projectImport] Skipping missing Reaper media: ${mediaRel}`,
        );
        continue;
      }
      if (!isAudioFilename(basename(mediaAbs))) {
        throw new ImportValidationError(
          `segment.rpp references unsupported media type: ${mediaRel}. Use MP3 or WAV under the segment folder.`,
        );
      }
      const copied = copyMediaBytes(mediaAbs, mtDest);
      bytesAdded += copied.bytesAdded;

      const startSec = readNonNegSec(getChildStruct(item, "POSITION")) ?? 0;
      const lengthSec = readNonNegSec(getChildStruct(item, "LENGTH"));
      const sourceOffsetSec =
        readNonNegSec(getChildStruct(item, "SOFFS")) ?? 0;
      const volState = readClipVolumeState(track, item);
      const playback = readItemPlayback(item);

      segments.push(
        entryFromClip({
          trackName,
          mediaBasename: copied.basename,
          startSec,
          lengthSec,
          sourceOffsetSec,
          volume: volState.volume,
          muted: volState.muted,
          existingManifest,
          ...playback,
          eqBands: trackFx.eqBands,
          reaEqChunkBase64: trackFx.reaEqChunkBase64,
          gate: trackFx.gate,
          reaGateChunkBase64: trackFx.reaGateChunkBase64,
          comp: trackFx.comp,
          reaCompChunkBase64: trackFx.reaCompChunkBase64,
        }),
      );
    }
  }

  if (segments.length === 0) {
    throw new ImportValidationError(
      skipMissingMedia
        ? "segment.rpp has no clips that match this segment's existing audio."
        : "segment.rpp has no usable audio clips. Add media under the segment folder, save in Reaper, re-zip, and import again.",
    );
  }

  const manifest: MultitrackManifest = {
    ...(existingManifest ?? {}),
    segments,
  };
  writeFileSync(
    join(mtDest, "tracks_manifest.json"),
    JSON.stringify(manifest, null, 2),
  );
  return { ok: true, manifest, bytesAdded };
}
