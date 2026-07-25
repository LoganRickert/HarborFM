import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
  statSync,
} from "fs";
import { basename, join } from "path";
import { nanoid } from "nanoid";
import { drizzleDb } from "../db/drizzle.js";
import { getPodcastOwnerId } from "./access.js";
import { findMultitrackDir } from "../modules/episodes/projectSegmentPack.js";
import {
  readTracksManifestFile,
  TRACKS_MANIFEST_NAME,
  TRACKS_MANIFEST_ORIGINAL_NAME,
} from "../modules/episodes/projectSegmentShared.js";
import { partitionTrimRangesAtSplit, waveformPath } from "../modules/segments/utils.js";
import * as repo from "../modules/segments/repo.js";
import { multitrackRecordingsDir } from "./paths.js";
import { wouldExceedStorageLimit } from "./storageLimit.js";
import {
  HOST_DUCKING_DEBUG_FILENAME,
  HOST_DUCKING_FILENAME,
  type HostDuckingFile,
} from "./hostDucking.js";
import type {
  MultitrackManifest,
  MultitrackSegmentEntry,
} from "./multitrackRemake.js";

export class SplitTracksManifestError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "SplitTracksManifestError";
    this.statusCode = statusCode;
  }
}

function clipStartMs(entry: MultitrackSegmentEntry): number {
  const raw =
    typeof entry.startMs === "number" && Number.isFinite(entry.startMs)
      ? entry.startMs
      : 0;
  return Math.max(0, raw);
}

function clipLengthMs(entry: MultitrackSegmentEntry): number {
  if (typeof entry.lengthMs === "number" && entry.lengthMs > 0) {
    return entry.lengthMs;
  }
  const start = clipStartMs(entry);
  if (typeof entry.endMs === "number" && entry.endMs > start) {
    return entry.endMs - start;
  }
  return 0;
}

function sourceOffsetMsOf(entry: MultitrackSegmentEntry): number {
  return typeof entry.sourceOffsetMs === "number" && entry.sourceOffsetMs > 0
    ? entry.sourceOffsetMs
    : 0;
}

function takeBasename(entry: MultitrackSegmentEntry): string | null {
  if (!entry.filePath || typeof entry.filePath !== "string") return null;
  const base = basename(entry.filePath.replace(/\\/g, "/"));
  return base || null;
}

function withPartitionedMuteSec(
  entry: MultitrackSegmentEntry,
  muteSec: Array<[number, number]> | undefined,
): MultitrackSegmentEntry {
  if (!muteSec || muteSec.length === 0) {
    const { muteSec: _drop, ...rest } = entry;
    void _drop;
    return rest;
  }
  return { ...entry, muteSec };
}

/** Shift clip timeline so segment B starts at 0. */
function shiftClipToSegmentB(
  entry: MultitrackSegmentEntry,
  splitMs: number,
  splitSec: number,
): MultitrackSegmentEntry {
  const start = clipStartMs(entry);
  const len = clipLengthMs(entry);
  const end = start + len;
  const mute =
    entry.muteSec && entry.muteSec.length > 0
      ? partitionTrimRangesAtSplit(entry.muteSec, splitSec).after
      : undefined;
  return withPartitionedMuteSec(
    {
      ...entry,
      startMs: start - splitMs,
      endMs: end - splitMs,
      lengthMs: len,
      sourceOffsetMs: sourceOffsetMsOf(entry),
    },
    mute,
  );
}

/**
 * Partition multitrack clips at splitMs (absolute timeline).
 * Clips wholly before stay on A; wholly after move to B (times shifted).
 * Clips that cross the blade become two clips (sourceOffset advanced on B).
 */
export function partitionTracksManifestClipsAtSplit(
  clips: MultitrackSegmentEntry[],
  splitMs: number,
): { before: MultitrackSegmentEntry[]; after: MultitrackSegmentEntry[] } {
  const before: MultitrackSegmentEntry[] = [];
  const after: MultitrackSegmentEntry[] = [];
  if (!(splitMs > 0) || !Number.isFinite(splitMs)) {
    return { before: [...clips], after: [] };
  }
  const splitSec = splitMs / 1000;

  for (const clip of clips) {
    const start = clipStartMs(clip);
    const len = clipLengthMs(clip);
    if (!(len > 0)) continue;
    const end = start + len;

    if (end <= splitMs) {
      const mute =
        clip.muteSec && clip.muteSec.length > 0
          ? partitionTrimRangesAtSplit(clip.muteSec, splitSec).before
          : undefined;
      before.push(withPartitionedMuteSec({ ...clip }, mute));
      continue;
    }

    if (start >= splitMs) {
      after.push(shiftClipToSegmentB(clip, splitMs, splitSec));
      continue;
    }

    // Crossing: blade into left (A) and right (B).
    const local = splitMs - start;
    const src = sourceOffsetMsOf(clip);
    if (local <= 1) {
      after.push(shiftClipToSegmentB(clip, splitMs, splitSec));
      continue;
    }
    if (local >= len - 1) {
      const mute =
        clip.muteSec && clip.muteSec.length > 0
          ? partitionTrimRangesAtSplit(clip.muteSec, splitSec).before
          : undefined;
      before.push(withPartitionedMuteSec({ ...clip }, mute));
      continue;
    }

    const muteParts =
      clip.muteSec && clip.muteSec.length > 0
        ? partitionTrimRangesAtSplit(clip.muteSec, splitSec)
        : { before: undefined as Array<[number, number]> | undefined, after: undefined };

    before.push(
      withPartitionedMuteSec(
        {
          ...clip,
          startMs: start,
          endMs: splitMs,
          lengthMs: local,
          sourceOffsetMs: src,
        },
        muteParts.before,
      ),
    );
    after.push(
      withPartitionedMuteSec(
        {
          ...clip,
          segmentId: nanoid(),
          startMs: 0,
          endMs: len - local,
          lengthMs: len - local,
          sourceOffsetMs: src + local,
        },
        muteParts.after,
      ),
    );
  }

  return { before, after };
}

function partitionManifestAtSplit(
  manifest: MultitrackManifest,
  splitMs: number,
): { before: MultitrackManifest; after: MultitrackManifest } {
  const clips = Array.isArray(manifest.segments) ? manifest.segments : [];
  const { before, after } = partitionTracksManifestClipsAtSplit(clips, splitMs);
  return {
    before: { ...manifest, segments: before },
    after: { ...manifest, segments: after },
  };
}

function readHostDucking(mtDir: string): HostDuckingFile | null {
  const path = join(mtDir, HOST_DUCKING_FILENAME);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as HostDuckingFile;
  } catch {
    return null;
  }
}

function partitionHostDuckingAtSplit(
  ducking: HostDuckingFile,
  splitSec: number,
  keepFiles: Set<string>,
  which: "before" | "after",
): HostDuckingFile {
  const tracks = (ducking.tracks ?? [])
    .filter((t) => {
      const base = basename((t.filePath || "").replace(/\\/g, "/"));
      return base && keepFiles.has(base);
    })
    .map((t) => {
      const mute = Array.isArray(t.mute) ? t.mute : [];
      const parts = partitionTrimRangesAtSplit(mute, splitSec);
      return {
        ...t,
        mute: which === "before" ? parts.before : parts.after,
      };
    });
  return { ...ducking, tracks };
}

function fileBasenamesFromClips(clips: MultitrackSegmentEntry[]): Set<string> {
  const out = new Set<string>();
  for (const c of clips) {
    const base = takeBasename(c);
    if (base) out.add(base);
  }
  return out;
}

function estimateCopyBytes(srcDir: string, basenames: Set<string>): number {
  let total = 0;
  for (const name of basenames) {
    const abs = join(srcDir, name);
    if (existsSync(abs)) total += statSync(abs).size;
    const wf = waveformPath(abs);
    if (existsSync(wf)) total += statSync(wf).size;
  }
  return total;
}

function writeManifest(mtDir: string, name: string, manifest: MultitrackManifest): void {
  writeFileSync(join(mtDir, name), JSON.stringify(manifest, null, 2));
}

function copyTakesToDir(
  srcDir: string,
  destDir: string,
  basenames: Set<string>,
): number {
  mkdirSync(destDir, { recursive: true });
  let bytes = 0;
  for (const name of basenames) {
    const src = join(srcDir, name);
    const dest = join(destDir, name);
    if (!existsSync(src)) continue;
    if (!existsSync(dest)) {
      copyFileSync(src, dest);
      bytes += statSync(dest).size;
    }
    const srcWf = waveformPath(src);
    const destWf = waveformPath(dest);
    if (existsSync(srcWf) && !existsSync(destWf)) {
      copyFileSync(srcWf, destWf);
      bytes += statSync(destWf).size;
    }
  }
  return bytes;
}

export type SplitTracksManifestResult = {
  applied: boolean;
  bytesAdded: number;
};

function collectAfterTakeBasenames(
  mtDirA: string,
  splitMs: number,
): { filesB: Set<string>; bytesNeeded: number } | null {
  const manifestA = readTracksManifestFile(mtDirA);
  if (!manifestA || !Array.isArray(manifestA.segments)) return null;

  const currentParts = partitionManifestAtSplit(manifestA, splitMs);
  const filesB = fileBasenamesFromClips(currentParts.after.segments ?? []);

  const originalManifest = readTracksManifestFile(
    mtDirA,
    TRACKS_MANIFEST_ORIGINAL_NAME,
  );
  if (originalManifest) {
    const originalParts = partitionManifestAtSplit(originalManifest, splitMs);
    for (const base of fileBasenamesFromClips(
      originalParts.after.segments ?? [],
    )) {
      filesB.add(base);
    }
  }

  return { filesB, bytesNeeded: estimateCopyBytes(mtDirA, filesB) };
}

/** Throw 403 if copying B's takes would exceed the podcast owner's storage limit. */
export function assertSplitTracksManifestStorageAllowed(opts: {
  podcastId: string;
  episodeId: string;
  segmentId: string;
  splitSec: number;
}): void {
  const { podcastId, episodeId, segmentId, splitSec } = opts;
  if (!(splitSec > 0) || !Number.isFinite(splitSec)) return;

  const mtDirA = findMultitrackDir(podcastId, episodeId, segmentId);
  if (!mtDirA) return;

  const splitMs = Math.round(splitSec * 1000);
  const plan = collectAfterTakeBasenames(mtDirA, splitMs);
  if (!plan || plan.bytesNeeded <= 0) return;

  const ownerId = getPodcastOwnerId(podcastId);
  if (
    ownerId &&
    wouldExceedStorageLimit(drizzleDb, ownerId, plan.bytesNeeded)
  ) {
    throw new SplitTracksManifestError("Storage limit exceeded", 403);
  }
}

/**
 * Split tracks_manifest (+ .original, host ducking) at splitSec for segment A,
 * and create segment B's recordings dir with the after-half clips and take files.
 * No-op when A has no multitrack recordings / manifest.
 */
export function splitSegmentTracksManifest(opts: {
  podcastId: string;
  episodeId: string;
  segmentId: string;
  newSegmentId: string;
  splitSec: number;
}): SplitTracksManifestResult {
  const { podcastId, episodeId, segmentId, newSegmentId, splitSec } = opts;
  if (!(splitSec > 0) || !Number.isFinite(splitSec)) {
    return { applied: false, bytesAdded: 0 };
  }

  const mtDirA = findMultitrackDir(podcastId, episodeId, segmentId);
  if (!mtDirA) return { applied: false, bytesAdded: 0 };

  const manifestA = readTracksManifestFile(mtDirA);
  if (!manifestA || !Array.isArray(manifestA.segments)) {
    return { applied: false, bytesAdded: 0 };
  }

  const splitMs = Math.round(splitSec * 1000);
  const currentParts = partitionManifestAtSplit(manifestA, splitMs);
  const filesB = fileBasenamesFromClips(currentParts.after.segments ?? []);

  const originalManifest = readTracksManifestFile(
    mtDirA,
    TRACKS_MANIFEST_ORIGINAL_NAME,
  );
  const originalParts = originalManifest
    ? partitionManifestAtSplit(originalManifest, splitMs)
    : null;
  if (originalParts) {
    for (const base of fileBasenamesFromClips(
      originalParts.after.segments ?? [],
    )) {
      filesB.add(base);
    }
  }

  // Storage should already be checked via assertSplitTracksManifestStorageAllowed.
  const mtDirB = multitrackRecordingsDir(podcastId, episodeId, newSegmentId);
  const bytesAdded = copyTakesToDir(mtDirA, mtDirB, filesB);

  writeManifest(mtDirB, TRACKS_MANIFEST_NAME, currentParts.after);
  if (originalParts) {
    writeManifest(mtDirB, TRACKS_MANIFEST_ORIGINAL_NAME, originalParts.after);
  }

  writeManifest(mtDirA, TRACKS_MANIFEST_NAME, currentParts.before);
  if (originalParts) {
    writeManifest(mtDirA, TRACKS_MANIFEST_ORIGINAL_NAME, originalParts.before);
  }

  const ducking = readHostDucking(mtDirA);
  if (ducking) {
    const filesA = fileBasenamesFromClips(currentParts.before.segments ?? []);
    writeFileSync(
      join(mtDirA, HOST_DUCKING_FILENAME),
      JSON.stringify(
        partitionHostDuckingAtSplit(ducking, splitSec, filesA, "before"),
        null,
        2,
      ),
    );
    writeFileSync(
      join(mtDirB, HOST_DUCKING_FILENAME),
      JSON.stringify(
        partitionHostDuckingAtSplit(ducking, splitSec, filesB, "after"),
        null,
        2,
      ),
    );
  }

  // Debug sidecar is regeneratable and uses absolute timeline coordinates.
  const debugA = join(mtDirA, HOST_DUCKING_DEBUG_FILENAME);
  if (existsSync(debugA)) {
    try {
      unlinkSync(debugA);
    } catch {
      /* ignore */
    }
  }

  const ownerId = getPodcastOwnerId(podcastId);
  if (ownerId && bytesAdded > 0) {
    repo.addUserDiskBytes(ownerId, bytesAdded);
  }

  return { applied: true, bytesAdded };
}
