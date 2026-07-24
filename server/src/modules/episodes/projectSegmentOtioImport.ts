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
  pruneTrimRangesForDuration,
  remakeMixFromMultitrackDir,
  type MultitrackManifest,
} from "../../services/multitrackRemake.js";
import {
  addUserDiskBytes,
  getSegmentById,
  updateSegmentAudio,
} from "../segments/repo.js";
import { findMultitrackDir } from "./projectSegmentPack.js";
import { isAudioFilename } from "./projectDawSidecars.js";
import {
  applyOtioTimelineToManifest,
  TIMELINE_OTIO_NAME,
} from "./projectDawOtioImport.js";
import {
  ImportValidationError,
  refreshMultitrackTrackSidecars,
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
 * Apply an uploaded timeline.otio against this segment's existing recordings/
 * (or mix audio for single-track), rebuild tracks_manifest, and remake audio.wav.
 * Resolve Fairlight FX are ignored; timing cuts/trims only.
 */
export async function importSegmentOtioTimeline(
  podcastId: string,
  episodeId: string,
  segmentId: string,
  otioPath: string,
  importerUserId: string,
): Promise<{ bytesAdded: number }> {
  const segment = getSegmentById(segmentId, episodeId);
  if (!segment) {
    throw new ImportValidationError("Segment not found");
  }
  if (!existsSync(otioPath) || !statSync(otioPath).isFile()) {
    throw new ImportValidationError("OTIO file is missing");
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
      "This segment has no recordings or audio to apply a timeline to.",
    );
  }

  const workDir = join(tmpdir(), `harborfm-otio-import-${nanoid()}`);
  mkdirSync(workDir, { recursive: true });
  let bytesAdded = 0;

  try {
    writeFileSync(join(workDir, TIMELINE_OTIO_NAME), readFileSync(otioPath));

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

    const applied = applyOtioTimelineToManifest({
      segDir: workDir,
      mtDest,
      existingManifest,
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

    await refreshMultitrackTrackSidecars(mtDest, manifest, {
      generateWaveforms: waveformsAvailable,
    });
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

    let trimRanges: unknown = null;
    if (typeof segment.trimRanges === "string" && segment.trimRanges.trim()) {
      try {
        trimRanges = JSON.parse(segment.trimRanges);
      } catch {
        trimRanges = null;
      }
    }
    const prunedTrims = pruneTrimRangesForDuration(
      trimRanges,
      remade.durationSec,
    );

    await audioService.generateWaveformFile(mixDest, episodeUploads);
    updateSegmentAudio(segmentId, episodeId, mixDest, remade.durationSec, {
      markers: stringifyJsonField(markers) ?? "[]",
      trimRanges: stringifyJsonField(prunedTrims) ?? "[]",
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

/** Write uploaded .otio bytes to a temp path. Caller / job owns cleanup. */
export function writeTempOtio(buffer: Buffer): string {
  const path = join(tmpdir(), `harborfm-otio-upload-${nanoid()}.otio`);
  writeFileSync(path, buffer);
  return path;
}

const otioImportStatusBySegment = new Map<
  string,
  "importing" | "done" | "failed"
>();
const otioImportErrorBySegment = new Map<string, string>();

/** Start a background OTIO-only import. Returns false if already running. */
export function startSegmentOtioImport(
  podcastId: string,
  episodeId: string,
  segmentId: string,
  tmpOtio: string,
  importerUserId: string,
  onSuccess?: () => void,
): boolean {
  if (otioImportStatusBySegment.get(segmentId) === "importing") return false;
  otioImportStatusBySegment.set(segmentId, "importing");
  otioImportErrorBySegment.delete(segmentId);
  setImmediate(() => {
    void importSegmentOtioTimeline(
      podcastId,
      episodeId,
      segmentId,
      tmpOtio,
      importerUserId,
    )
      .then(() => {
        otioImportStatusBySegment.set(segmentId, "done");
        onSuccess?.();
      })
      .catch((err: unknown) => {
        otioImportStatusBySegment.set(segmentId, "failed");
        const message =
          err instanceof ImportValidationError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Failed to import OTIO file";
        otioImportErrorBySegment.set(segmentId, message);
      })
      .finally(() => {
        removeTempPath(tmpOtio);
      });
  });
  return true;
}

export function getSegmentOtioImportStatus(segmentId: string): {
  status: "idle" | "importing" | "done" | "failed";
  error?: string;
} {
  const status = otioImportStatusBySegment.get(segmentId);
  if (!status) return { status: "idle" };
  if (status === "importing") return { status: "importing" };
  const error = otioImportErrorBySegment.get(segmentId);
  otioImportStatusBySegment.delete(segmentId);
  otioImportErrorBySegment.delete(segmentId);
  if (status === "failed") return { status: "failed", error };
  return { status: "done" };
}
