import { existsSync, unlinkSync, writeFileSync, readFileSync, statSync } from "fs";
import { basename, dirname, join } from "path";
import { resolveDataPath, segmentPath, uploadsDir } from "./paths.js";
import * as audioService from "./audio.js";
import {
  pruneMarkersForDuration,
  pruneTrimRangesForDuration,
  trimOverlappingSoundboardEntries,
  type MultitrackManifest,
  type MultitrackSegmentEntry,
} from "./multitrackRemake.js";
import { remakeMixWithOptionalWorker } from "./segmentRemakeWorker.js";
import {
  buildManifestForRemake,
  readHostDuckingFile,
} from "./hostDucking.js";
import { findMultitrackDir } from "../modules/episodes/projectSegmentPack.js";
import {
  ensureOriginalTracksManifest,
  readTracksManifestFile,
  TRACKS_MANIFEST_NAME,
  refreshMultitrackTrackSidecars,
} from "../modules/episodes/projectSegmentShared.js";
import {
  getSegmentById,
  updateSegmentAudio,
} from "../modules/segments/repo.js";
import { waveformPath } from "../modules/segments/utils.js";
import { effectiveTakeRangeSec } from "./hostDucking.js";
import type { SegmentTrackClip } from "@harborfm/shared";

/** Match DAW export: skip near-empty reconnect / failed-join stubs. */
const MIN_TAKE_MEDIA_BYTES = 2048;

function isUsableTakeMedia(absPath: string): boolean {
  if (!existsSync(absPath)) return false;
  try {
    return statSync(absPath).size >= MIN_TAKE_MEDIA_BYTES;
  } catch {
    return false;
  }
}

function clipFileBasename(entry: { filePath?: string }): string | null {
  const rel = typeof entry.filePath === "string" ? entry.filePath : "";
  if (!rel) return null;
  const base = basename(rel.replace(/\\/g, "/"));
  if (!base || base.includes("..")) return null;
  return base;
}

function filterUsableClips(
  mtDir: string,
  clips: MultitrackSegmentEntry[],
): MultitrackSegmentEntry[] {
  const out: MultitrackSegmentEntry[] = [];
  for (const c of clips) {
    const base = clipFileBasename(c);
    if (!base) continue;
    if (!isUsableTakeMedia(join(mtDir, base))) continue;
    out.push({ ...c, filePath: base });
  }
  return out;
}

/**
 * Call recordings often leave endMs at session end for every take. Short
 * soundboard / join clips then look hours long in the editor. Clamp to the
 * real media length (same rule as host ducking), unless the clip loops.
 */
function clampClipToMediaDuration(
  mtDir: string,
  entry: MultitrackSegmentEntry,
): MultitrackSegmentEntry {
  if (entry.loop === true) return entry;
  // Editor / saved clips already carry intentional lengthMs; skip expensive
  // sync waveform parse (can stall the event loop on large takes).
  if (typeof entry.lengthMs === "number" && Number.isFinite(entry.lengthMs) && entry.lengthMs > 0) {
    return entry;
  }
  const base = clipFileBasename(entry);
  if (!base) return entry;
  const wfAbs = waveformPath(join(mtDir, base));
  if (!existsSync(wfAbs)) return entry;
  let waveform: {
    version?: number;
    channels?: number;
    sample_rate?: number;
    samples_per_pixel?: number;
    bits?: number;
    length?: number;
    data?: number[];
  };
  try {
    waveform = JSON.parse(readFileSync(wfAbs, "utf8")) as typeof waveform;
  } catch {
    return entry;
  }
  if (!Array.isArray(waveform.data) || waveform.data.length < 2) return entry;
  const range = effectiveTakeRangeSec(entry, {
    ...waveform,
    data: waveform.data,
  });
  if (!range) return entry;
  const startMs = Math.round(range.startSec * 1000);
  const endMs = Math.round(range.endSec * 1000);
  const lengthMs = endMs - startMs;
  if (lengthMs <= 0) return entry;
  const prevLen =
    typeof entry.endMs === "number" &&
    typeof entry.startMs === "number" &&
    entry.endMs > entry.startMs
      ? entry.endMs - entry.startMs
      : null;
  // Already within ~50ms of media length: keep as-is.
  if (prevLen != null && Math.abs(prevLen - lengthMs) <= 50) {
    return { ...entry, lengthMs, endMs: startMs + lengthMs };
  }
  if (prevLen != null && prevLen <= lengthMs + 50) {
    // Explicit shorter trim than media: keep editor/intentional length.
    return {
      ...entry,
      lengthMs: prevLen,
      endMs: startMs + prevLen,
    };
  }
  return {
    ...entry,
    startMs,
    lengthMs,
    endMs,
  };
}

function normalizeClipsForEditor(
  mtDir: string,
  clips: MultitrackSegmentEntry[],
): MultitrackSegmentEntry[] {
  const clamped = clips.map((c) => clampClipToMediaDuration(mtDir, c));
  return trimOverlappingSoundboardEntries(clamped);
}

function clipTimelineEndMs(entry: MultitrackSegmentEntry): number {
  const startMs = typeof entry.startMs === "number" ? entry.startMs : 0;
  if (typeof entry.lengthMs === "number" && entry.lengthMs > 0) {
    return startMs + entry.lengthMs;
  }
  if (typeof entry.endMs === "number" && entry.endMs > startMs) {
    return entry.endMs;
  }
  return startMs;
}

export function timelineDurationMsFromClips(
  clips: MultitrackSegmentEntry[],
): number {
  let max = 0;
  for (const c of clips) {
    max = Math.max(max, clipTimelineEndMs(c));
  }
  return max;
}

export function listTakesFromClips(
  mtDir: string,
  clips: MultitrackSegmentEntry[],
): Array<{
  filePath: string;
  participantName: string | null;
  soundboardAssetId: string | null;
  source: string | null;
  waveformExists: boolean;
}> {
  const byFile = new Map<
    string,
    {
      filePath: string;
      participantName: string | null;
      soundboardAssetId: string | null;
      source: string | null;
      waveformExists: boolean;
    }
  >();
  for (const c of clips) {
    const base = clipFileBasename(c);
    if (!base) continue;
    if (byFile.has(base)) continue;
    const abs = join(mtDir, base);
    if (!isUsableTakeMedia(abs)) continue;
    const name =
      typeof c.participantName === "string" && c.participantName.trim()
        ? c.participantName.trim()
        : null;
    const soundboardAssetId =
      typeof c.soundboardAssetId === "string" && c.soundboardAssetId.trim()
        ? c.soundboardAssetId.trim()
        : null;
    const source =
      typeof c.source === "string" && c.source.trim() ? c.source.trim() : null;
    const wf = waveformPath(abs);
    let waveformExists = existsSync(wf);
    if (waveformExists) {
      try {
        const parsed = JSON.parse(readFileSync(wf, "utf8")) as {
          data?: unknown;
          length?: number;
        };
        const dataLen = Array.isArray(parsed.data) ? parsed.data.length : 0;
        const pairs =
          typeof parsed.length === "number" && parsed.length > 0
            ? parsed.length
            : Math.floor(dataLen / 2);
        waveformExists = pairs > 0 && dataLen >= 2;
      } catch {
        waveformExists = false;
      }
    }
    byFile.set(base, {
      filePath: base,
      participantName: name,
      soundboardAssetId,
      source,
      waveformExists,
    });
  }
  return [...byFile.values()];
}

export function readSegmentTracks(opts: {
  podcastId: string;
  episodeId: string;
  segmentId: string;
}): {
  clips: MultitrackSegmentEntry[];
  takes: Array<{
    filePath: string;
    participantName: string | null;
    soundboardAssetId: string | null;
    source: string | null;
    waveformExists: boolean;
  }>;
  timelineDurationMs: number;
} | null {
  const mtDir = findMultitrackDir(
    opts.podcastId,
    opts.episodeId,
    opts.segmentId,
  );
  if (!mtDir) return null;
  const manifest = readTracksManifestFile(mtDir);
  const raw = Array.isArray(manifest?.segments) ? manifest!.segments! : [];
  // Drop reconnect/failed-join stubs (DAW export and mix remake already skip these).
  const clips = normalizeClipsForEditor(mtDir, filterUsableClips(mtDir, raw));
  return {
    clips,
    takes: listTakesFromClips(mtDir, clips),
    timelineDurationMs: timelineDurationMsFromClips(clips),
  };
}

function sanitizeClips(
  clips: SegmentTrackClip[],
  mtDir: string,
): MultitrackSegmentEntry[] {
  const out: MultitrackSegmentEntry[] = [];
  for (const raw of clips) {
    const base = basename(String(raw.filePath).replace(/\\/g, "/"));
    if (!base || base.includes("..")) {
      throw new Error(`Invalid clip filePath: ${raw.filePath}`);
    }
    const abs = join(mtDir, base);
    if (!existsSync(abs)) {
      throw new Error(`Clip media missing on server: ${base}`);
    }
    // Ignore stubs the client may still send; do not fail the whole save.
    if (!isUsableTakeMedia(abs)) continue;
    // Trust editor lengths on save; do not sync-parse waveform.json here
    // (that stalls the API when many large takes are present).
    const entry: MultitrackSegmentEntry = {
      ...(raw as MultitrackSegmentEntry),
      filePath: base,
    };
    out.push(entry);
  }
  if (out.length === 0) {
    throw new Error("At least one clip is required");
  }
  return trimOverlappingSoundboardEntries(out);
}

/**
 * Write clips to tracks_manifest.json (no mix remake).
 * Backs up tracks_manifest.json.original once when missing (same as OTIO/Reaper import).
 */
export function saveSegmentTracksClips(opts: {
  podcastId: string;
  episodeId: string;
  segmentId: string;
  clips: SegmentTrackClip[];
}): {
  clips: MultitrackSegmentEntry[];
  timelineDurationMs: number;
  originalBackedUp: boolean;
} {
  const { podcastId, episodeId, segmentId, clips } = opts;
  const mtDir = findMultitrackDir(podcastId, episodeId, segmentId);
  if (!mtDir) {
    throw new Error("No multitrack recordings for this segment");
  }

  const originalBackedUp = ensureOriginalTracksManifest(mtDir);

  const existingManifest = readTracksManifestFile(mtDir) ?? {};
  const sanitized = sanitizeClips(clips, mtDir);
  const manifest: MultitrackManifest = {
    ...existingManifest,
    segments: sanitized,
  };

  // Sidecars are refreshed asynchronously in remake path; keep sync write here.
  writeFileSync(
    join(mtDir, TRACKS_MANIFEST_NAME),
    JSON.stringify(manifest, null, 2),
  );

  return {
    clips: sanitized,
    timelineDurationMs: timelineDurationMsFromClips(sanitized),
    originalBackedUp,
  };
}

/**
 * Write clips to tracks_manifest.json and remake the segment mix.
 */
export async function applySegmentClipsAndRemake(opts: {
  podcastId: string;
  episodeId: string;
  segmentId: string;
  clips: SegmentTrackClip[];
  apiBase?: string | null;
  userId?: string | null;
}): Promise<{ durationSec: number }> {
  const { podcastId, episodeId, segmentId, clips, apiBase, userId } = opts;

  const mtDir = findMultitrackDir(podcastId, episodeId, segmentId);
  if (!mtDir) {
    throw new Error("No multitrack recordings for this segment");
  }

  ensureOriginalTracksManifest(mtDir);

  const existingManifest = readTracksManifestFile(mtDir) ?? {};
  const sanitized = sanitizeClips(clips, mtDir);
  const manifest: MultitrackManifest = {
    ...existingManifest,
    segments: sanitized,
  };

  await refreshMultitrackTrackSidecars(mtDir, manifest, {
    generateWaveforms: false,
  });
  writeFileSync(
    join(mtDir, TRACKS_MANIFEST_NAME),
    JSON.stringify(manifest, null, 2),
  );

  return remakeSegmentMixFromManifest({
    podcastId,
    episodeId,
    segmentId,
    mtDir,
    manifest,
    apiBase,
    userId,
  });
}

/**
 * Remake the segment mix from the current tracks_manifest.json on disk.
 */
export async function remakeSegmentMixFromSavedTracks(opts: {
  podcastId: string;
  episodeId: string;
  segmentId: string;
  apiBase?: string | null;
  userId?: string | null;
}): Promise<{ durationSec: number }> {
  const { podcastId, episodeId, segmentId, apiBase, userId } = opts;
  const mtDir = findMultitrackDir(podcastId, episodeId, segmentId);
  if (!mtDir) {
    throw new Error("No multitrack recordings for this segment");
  }
  const manifest = readTracksManifestFile(mtDir);
  if (
    !manifest ||
    !Array.isArray(manifest.segments) ||
    manifest.segments.length === 0
  ) {
    throw new Error("No multitrack clips to remake");
  }
  return remakeSegmentMixFromManifest({
    podcastId,
    episodeId,
    segmentId,
    mtDir,
    manifest,
    apiBase,
    userId,
  });
}

async function remakeSegmentMixFromManifest(opts: {
  podcastId: string;
  episodeId: string;
  segmentId: string;
  mtDir: string;
  manifest: MultitrackManifest;
  apiBase?: string | null;
  userId?: string | null;
}): Promise<{ durationSec: number }> {
  const { podcastId, episodeId, segmentId, mtDir, manifest, apiBase, userId } =
    opts;

  await refreshMultitrackTrackSidecars(mtDir, manifest, {
    generateWaveforms: false,
  });

  const existing = getSegmentById(segmentId, episodeId);
  const duckingEnabled = Boolean(existing?.hostDuckingEnabled);
  const ducking = duckingEnabled ? readHostDuckingFile(mtDir) : null;
  const remakeManifest = buildManifestForRemake(manifest, ducking, mtDir);

  const episodeUploads = uploadsDir(podcastId, episodeId);
  const mixDest = segmentPath(podcastId, episodeId, segmentId, "wav");
  const remade = await remakeMixWithOptionalWorker({
    podcastId,
    episodeId,
    segmentId,
    mtDir,
    remakeManifest,
    mixDest,
    allowedBaseDir: episodeUploads,
    apiBase,
    userId,
  });

  let markers: unknown = existing?.markers ?? [];
  if (typeof markers === "string" && markers) {
    try {
      markers = JSON.parse(markers);
    } catch {
      markers = [];
    }
  }
  markers = pruneMarkersForDuration(markers, remade.durationSec);

  let trimRanges: unknown = existing?.trimRanges ?? [];
  if (typeof trimRanges === "string" && trimRanges) {
    try {
      trimRanges = JSON.parse(trimRanges);
    } catch {
      trimRanges = [];
    }
  }
  const prunedTrims = pruneTrimRangesForDuration(
    trimRanges,
    remade.durationSec,
  );

  const oldAudio =
    existing && typeof existing.audioPath === "string"
      ? existing.audioPath
      : null;
  if (oldAudio) {
    try {
      const prev = resolveDataPath(oldAudio);
      if (existsSync(prev) && prev !== mixDest) {
        unlinkSync(prev);
        const prevWav = waveformPath(prev);
        if (existsSync(prevWav)) unlinkSync(prevWav);
      }
    } catch {
      // best-effort
    }
  }

  await audioService.generateWaveformFile(mixDest, episodeUploads);
  updateSegmentAudio(segmentId, episodeId, mixDest, remade.durationSec, {
    markers: JSON.stringify(markers ?? []),
    trimRanges: JSON.stringify(prunedTrims),
  });

  return { durationSec: remade.durationSec };
}

export type ApplyClipsJobStatus = "idle" | "remaking" | "done" | "failed";

const jobStatusBySegment = new Map<string, "remaking" | "done" | "failed">();
const jobErrorBySegment = new Map<string, string>();
const pendingClipsBySegment = new Map<string, SegmentTrackClip[] | "disk">();

export function startApplySegmentClipsJob(opts: {
  podcastId: string;
  episodeId: string;
  segmentId: string;
  clips: SegmentTrackClip[];
  onSuccess?: () => void;
}): boolean {
  return startRemakeSegmentTracksJob({
    ...opts,
    clips: opts.clips,
  });
}

/** Remake mix from provided clips (writes first) or from the saved manifest. */
export function startRemakeSegmentTracksJob(opts: {
  podcastId: string;
  episodeId: string;
  segmentId: string;
  /** When omitted, remake from tracks_manifest.json on disk. */
  clips?: SegmentTrackClip[];
  apiBase?: string | null;
  userId?: string | null;
  onSuccess?: () => void;
}): boolean {
  const { podcastId, episodeId, segmentId, clips, apiBase, userId, onSuccess } =
    opts;
  if (jobStatusBySegment.get(segmentId) === "remaking") return false;
  jobStatusBySegment.set(segmentId, "remaking");
  jobErrorBySegment.delete(segmentId);
  pendingClipsBySegment.set(segmentId, clips ?? "disk");
  setImmediate(() => {
    const pending = pendingClipsBySegment.get(segmentId) ?? clips ?? "disk";
    pendingClipsBySegment.delete(segmentId);
    const run =
      pending === "disk"
        ? remakeSegmentMixFromSavedTracks({
            podcastId,
            episodeId,
            segmentId,
            apiBase,
            userId,
          })
        : applySegmentClipsAndRemake({
            podcastId,
            episodeId,
            segmentId,
            clips: pending,
            apiBase,
            userId,
          });
    void run
      .then(() => {
        jobStatusBySegment.set(segmentId, "done");
        onSuccess?.();
      })
      .catch((err: unknown) => {
        console.error("[applySegmentClips] remake failed", {
          podcastId,
          episodeId,
          segmentId,
          err,
        });
        jobStatusBySegment.set(segmentId, "failed");
        const message =
          err instanceof Error && err.message
            ? err.message
            : "Failed to apply clips";
        const safe =
          message.startsWith("No multitrack") ||
          message.startsWith("Clip media") ||
          message.startsWith("Invalid clip") ||
          message.startsWith("At least one") ||
          message.startsWith("No multitrack clips")
            ? message
            : "Failed to remake mix";
        jobErrorBySegment.set(segmentId, safe);
      });
  });
  return true;
}

export function getApplySegmentClipsJobStatus(segmentId: string): {
  status: ApplyClipsJobStatus;
  error?: string;
} {
  const status = jobStatusBySegment.get(segmentId);
  if (!status) return { status: "idle" };
  if (status === "remaking") return { status: "remaking" };
  const error = jobErrorBySegment.get(segmentId);
  jobStatusBySegment.delete(segmentId);
  jobErrorBySegment.delete(segmentId);
  if (status === "failed") return { status: "failed", error };
  return { status: "done" };
}

/** Absolute path to a usable take file under the segment recordings folder, or null. */
export function resolveTakeAudioAbsPath(opts: {
  podcastId: string;
  episodeId: string;
  segmentId: string;
  filePath: string;
}): string | null {
  const mtDir = findMultitrackDir(
    opts.podcastId,
    opts.episodeId,
    opts.segmentId,
  );
  if (!mtDir) return null;
  const base = basename(opts.filePath.replace(/\\/g, "/"));
  if (!base || base.includes("..")) return null;
  const abs = join(mtDir, base);
  if (!isUsableTakeMedia(abs)) return null;
  return abs;
}

/** Read take waveform JSON if present. */
export function readTakeWaveformJson(opts: {
  podcastId: string;
  episodeId: string;
  segmentId: string;
  filePath: string;
}): string | null {
  const abs = resolveTakeAudioAbsPath(opts);
  if (!abs) return null;
  const wf = waveformPath(abs);
  if (!existsSync(wf)) return null;
  return readFileSync(wf, "utf8");
}

/**
 * Return take waveform JSON, generating the audiowaveform sidecar only when
 * missing. Existing `*.waveform.json` files are read as-is and never rewritten.
 */
export async function ensureTakeWaveformJson(opts: {
  podcastId: string;
  episodeId: string;
  segmentId: string;
  filePath: string;
}): Promise<string | null> {
  const existing = readTakeWaveformJson(opts);
  if (existing != null) return existing;

  const abs = resolveTakeAudioAbsPath(opts);
  if (!abs) return null;
  const mtDir = dirname(abs);
  const wf = waveformPath(abs);
  // Re-check after resolve in case of a race; never overwrite an existing file.
  if (existsSync(wf)) {
    return readFileSync(wf, "utf8");
  }
  try {
    await audioService.generateWaveformFile(abs, mtDir);
  } catch (err) {
    console.warn(
      "[tracks] Failed to generate take waveform",
      opts.filePath,
      err,
    );
    return null;
  }
  if (!existsSync(wf)) return null;
  return readFileSync(wf, "utf8");
}
