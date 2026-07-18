import {
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { basename, extname, join } from "path";
import { tmpdir } from "os";
import { nanoid } from "nanoid";
import { AUDIOWAVEFORM_PATH } from "../../config.js";
import { checkCommand } from "../../utils/commands.js";
import { getPodcastOwnerId } from "../../services/access.js";
import {
  multitrackRecordingsDir,
  resolveDataPath,
  segmentPath,
  uploadsDir,
} from "../../services/paths.js";
import * as audioService from "../../services/audio.js";
import {
  pruneMarkersForDuration,
  remakeMixFromMultitrackDir,
  type MultitrackManifest,
} from "../../services/multitrackRemake.js";
import { sha256FileSync } from "../../utils/hash.js";
import { waveformPath } from "../segments/utils.js";
import {
  addUserDiskBytes,
  getSegmentById,
  updateSegmentAudio,
} from "../segments/repo.js";
import { findMultitrackDir } from "./projectSegmentPack.js";
import { isAudioFilename } from "./projectDawSidecars.js";
import { applyTimelineSidecarToManifest } from "./projectDawTimelineImport.js";
import {
  ImportValidationError,
  stringifyJsonField,
} from "./projectSegmentShared.js";
import { removeTempPath } from "./projectImport.js";

function linkOrCopy(src: string, dest: string): void {
  if (existsSync(dest)) return;
  try {
    linkSync(src, dest);
  } catch {
    copyFileSync(src, dest);
  }
}

function readExistingManifest(mtDir: string): MultitrackManifest | null {
  const manifestPath = join(mtDir, "tracks_manifest.json");
  if (!existsSync(manifestPath)) return null;
  try {
    return JSON.parse(readFileSync(manifestPath, "utf8")) as MultitrackManifest;
  } catch {
    return null;
  }
}

/**
 * Apply an uploaded segment.rpp against this segment's existing recordings/
 * (or mix audio for single-track), rebuild tracks_manifest, and remake audio.wav.
 */
export async function importSegmentReaperRpp(
  podcastId: string,
  episodeId: string,
  segmentId: string,
  rppPath: string,
  importerUserId: string,
): Promise<{ bytesAdded: number }> {
  const segment = getSegmentById(segmentId, episodeId);
  if (!segment) {
    throw new ImportValidationError("Segment not found");
  }
  if (!existsSync(rppPath) || !statSync(rppPath).isFile()) {
    throw new ImportValidationError("Reaper file is missing");
  }

  const mtExisting = findMultitrackDir(podcastId, episodeId, segmentId);
  const audioPathRel =
    typeof segment.audioPath === "string" && segment.audioPath.trim()
      ? segment.audioPath
      : null;
  const audioAbs =
    audioPathRel && existsSync(resolveDataPath(audioPathRel))
      ? resolveDataPath(audioPathRel)
      : null;

  if (!mtExisting && !audioAbs) {
    throw new ImportValidationError(
      "This segment has no recordings or audio to apply a Reaper project to.",
    );
  }

  const workDir = join(tmpdir(), `harborfm-reaper-import-${nanoid()}`);
  mkdirSync(workDir, { recursive: true });
  let bytesAdded = 0;

  try {
    writeFileSync(join(workDir, "segment.rpp"), readFileSync(rppPath));

    let existingManifest: MultitrackManifest | null = null;
    let epochMs: number | undefined;

    if (mtExisting) {
      existingManifest = readExistingManifest(mtExisting);
      if (typeof existingManifest?.recordingEpochMs === "number") {
        epochMs = existingManifest.recordingEpochMs;
      }
      const recWork = join(workDir, "recordings");
      mkdirSync(recWork, { recursive: true });
      for (const name of readdirSync(mtExisting)) {
        const src = join(mtExisting, name);
        if (!statSync(src).isFile()) continue;
        if (name === "tracks_manifest.json") continue;
        if (!isAudioFilename(name)) continue;
        linkOrCopy(src, join(recWork, name));
      }
    }

    if (audioAbs) {
      const ext = extname(audioAbs) || ".wav";
      const audioName = `audio${ext.toLowerCase()}`;
      linkOrCopy(audioAbs, join(workDir, audioName));
      const base = basename(audioAbs);
      if (base !== audioName) {
        linkOrCopy(audioAbs, join(workDir, base));
      }
    }

    const mtDest =
      mtExisting ??
      multitrackRecordingsDir(podcastId, episodeId, segmentId, epochMs);
    mkdirSync(mtDest, { recursive: true });

    const applied = applyTimelineSidecarToManifest({
      segDir: workDir,
      mtDest,
      existingManifest,
      skipMissingMedia: true,
    });
    if (!applied.ok) {
      throw new ImportValidationError(applied.error);
    }
    bytesAdded += applied.bytesAdded;
    const manifest = applied.manifest;

    const episodeUploads = uploadsDir(podcastId, episodeId);
    const waveformsAvailable = await checkCommand(AUDIOWAVEFORM_PATH, [
      "--version",
    ]);

    for (const entry of manifest.segments ?? []) {
      const rel = typeof entry.filePath === "string" ? entry.filePath : null;
      if (!rel) continue;
      const trackAbs = join(mtDest, basename(rel.replace(/\\/g, "/")));
      if (!existsSync(trackAbs)) continue;
      try {
        if (waveformsAvailable) {
          await audioService.generateWaveformFile(trackAbs, mtDest);
        }
        entry.fileSha256 = sha256FileSync(trackAbs) ?? entry.fileSha256;
        entry.waveformSha256 =
          sha256FileSync(waveformPath(trackAbs)) ?? undefined;
      } catch {
        // non-fatal
      }
    }
    writeFileSync(
      join(mtDest, "tracks_manifest.json"),
      JSON.stringify(manifest, null, 2),
    );

    const mixDest = segmentPath(podcastId, episodeId, segmentId, "wav");
    const remade = await remakeMixFromMultitrackDir(
      mtDest,
      manifest,
      mixDest,
      episodeUploads,
    );

    if (audioAbs && audioAbs !== mixDest && existsSync(audioAbs)) {
      try {
        unlinkSync(audioAbs);
      } catch {
        // ignore
      }
    }

    let markers: unknown = null;
    if (typeof segment.markers === "string" && segment.markers.trim()) {
      try {
        markers = JSON.parse(segment.markers);
      } catch {
        markers = null;
      }
    }
    markers = pruneMarkersForDuration(markers, remade.durationSec);

    await audioService.generateWaveformFile(mixDest, episodeUploads);
    updateSegmentAudio(segmentId, episodeId, mixDest, remade.durationSec, {
      markers: stringifyJsonField(markers) ?? "[]",
    });
    bytesAdded += statSync(mixDest).size;

    const ownerId = getPodcastOwnerId(podcastId) ?? importerUserId;
    if (bytesAdded > 0) {
      addUserDiskBytes(ownerId, bytesAdded);
    }

    return { bytesAdded };
  } finally {
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
}

/** Write uploaded .rpp bytes to a temp path. Caller / job owns cleanup. */
export function writeTempRpp(buffer: Buffer): string {
  const path = join(tmpdir(), `harborfm-reaper-upload-${nanoid()}.rpp`);
  writeFileSync(path, buffer);
  return path;
}

const reaperImportStatusBySegment = new Map<
  string,
  "importing" | "done" | "failed"
>();
const reaperImportErrorBySegment = new Map<string, string>();

/** Start a background Reaper-only import. Returns false if already running. */
export function startSegmentReaperImport(
  podcastId: string,
  episodeId: string,
  segmentId: string,
  tmpRpp: string,
  importerUserId: string,
  onSuccess?: () => void,
): boolean {
  if (reaperImportStatusBySegment.get(segmentId) === "importing") return false;
  reaperImportStatusBySegment.set(segmentId, "importing");
  reaperImportErrorBySegment.delete(segmentId);
  setImmediate(() => {
    void importSegmentReaperRpp(
      podcastId,
      episodeId,
      segmentId,
      tmpRpp,
      importerUserId,
    )
      .then(() => {
        reaperImportStatusBySegment.set(segmentId, "done");
        onSuccess?.();
      })
      .catch((err: unknown) => {
        reaperImportStatusBySegment.set(segmentId, "failed");
        const message =
          err instanceof ImportValidationError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Failed to import Reaper file";
        reaperImportErrorBySegment.set(segmentId, message);
      })
      .finally(() => {
        removeTempPath(tmpRpp);
      });
  });
  return true;
}

export function getSegmentReaperImportStatus(segmentId: string): {
  status: "idle" | "importing" | "done" | "failed";
  error?: string;
} {
  const status = reaperImportStatusBySegment.get(segmentId);
  if (!status) return { status: "idle" };
  if (status === "importing") return { status: "importing" };
  const error = reaperImportErrorBySegment.get(segmentId);
  reaperImportStatusBySegment.delete(segmentId);
  reaperImportErrorBySegment.delete(segmentId);
  if (status === "failed") return { status: "failed", error };
  return { status: "done" };
}
