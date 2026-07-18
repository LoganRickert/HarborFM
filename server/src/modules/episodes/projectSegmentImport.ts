import {
  copyFileSync,
  existsSync,
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
import AdmZip from "adm-zip";
import { and, eq } from "drizzle-orm";
import { AUDIOWAVEFORM_PATH } from "../../config.js";
import { checkCommand } from "../../utils/commands.js";
import { drizzleDb } from "../../db/index.js";
import { episodeSegments } from "../../db/schema.js";
import { getPodcastOwnerId } from "../../services/access.js";
import {
  assertResolvedPathUnder,
  multitrackRecordingsDir,
  pathRelativeToData,
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
  updateSegmentHostDuckingEnabled,
  updateSegmentMarkers,
} from "../segments/repo.js";
import { findMultitrackDir } from "./projectSegmentPack.js";
import { PROJECT_FORMAT_VERSION } from "./projectExport.js";
import { removeTempPath } from "./projectImport.js";
import {
  applyTimelineSidecarToManifest,
  REAPER_IGNORED_WARNING,
  timelineSidecarNeedsApply,
} from "./projectDawTimelineImport.js";
import {
  buildManifestForRemake,
  HOST_DUCKING_FILENAME,
  readHostDuckingFile,
} from "../../services/hostDucking.js";
import {
  findSegmentAudioFile,
  ImportValidationError,
  nameFromSegmentFolder,
  pruneMissingManifestTracks,
  readJsonFile,
  recordingsTracksChanged,
  rewriteManifestPaths,
  stringifyJsonField,
  type SegmentProjectJson,
} from "./projectSegmentShared.js";

export type SegmentImportResult = {
  segmentId: string;
  bytesAdded: number;
  /** Non-fatal notice for the client (e.g. Reaper file ignored). */
  warning?: string;
};

/**
 * Apply one packed segment folder onto an existing segment (overwrite in place).
 * Shared rules with episode import: hash-aware waveforms, WAV to MP3, multitrack remake.
 */
export async function applySegmentFolderOntoExisting(opts: {
  podcastId: string;
  episodeId: string;
  segmentId: string;
  segDir: string;
  libraryRoot?: string | null;
  importerUserId: string;
}): Promise<SegmentImportResult> {
  const { podcastId, episodeId, segmentId, segDir, importerUserId } = opts;
  const existing = getSegmentById(segmentId, episodeId);
  if (!existing) {
    throw new ImportValidationError("Segment not found");
  }

  const segJsonPath = join(segDir, "segment.json");
  const missingSegmentJson = !existsSync(segJsonPath);
  const segMeta: SegmentProjectJson = missingSegmentJson
    ? {
        type: "recorded",
        name: nameFromSegmentFolder(basename(segDir)),
        durationSec: 0,
        audioFile: null,
      }
    : readJsonFile<SegmentProjectJson>(segJsonPath);

  const audioSrc = findSegmentAudioFile(segDir, segMeta.audioFile);
  if (!audioSrc) {
    throw new ImportValidationError(
      "Segment project must include segment/audio.mp3 or segment/audio.wav",
    );
  }

  const episodeUploads = uploadsDir(podcastId, episodeId);
  const waveformsAvailable = await checkCommand(AUDIOWAVEFORM_PATH, [
    "--version",
  ]);
  let bytesAdded = 0;
  let warning: string | undefined;

  // Prefer storing as recorded overwrite for a consistent in-place edit.
  // If zip includes library/ for a reusable asset, recreate and promote to recorded.
  let durationSec =
    typeof segMeta.durationSec === "number" ? segMeta.durationSec : 0;
  let markers: unknown = segMeta.markers ?? existing.markers;
  const name =
    segMeta.name !== undefined
      ? segMeta.name
      : ((existing.name as string | null) ?? null);

  const oldAudio =
    existing.type === "recorded" && typeof existing.audioPath === "string"
      ? existing.audioPath
      : null;

  const oldMt = findMultitrackDir(podcastId, episodeId, segmentId);

  let audioAbsDest: string | null = null;
  let audioPathRel: string | null = null;
  let audioChanged = missingSegmentJson;
  let needSegmentWaveformRegen = missingSegmentJson;
  const missingWaveformInZip = !existsSync(join(segDir, "waveform.json"));

  const srcExt = extname(audioSrc).toLowerCase().replace(/^\./, "") || "mp3";
  if (srcExt === "wav") {
    const dest = segmentPath(podcastId, episodeId, segmentId, "mp3");
    assertResolvedPathUnder(dest, episodeUploads);
    const stagedWav = join(episodeUploads, `_import_${segmentId}.wav`);
    copyFileSync(audioSrc, stagedWav);
    try {
      await audioService.transcodeToMp3(stagedWav, dest, episodeUploads);
    } finally {
      try {
        rmSync(stagedWav, { force: true });
      } catch {
        // ignore
      }
    }
    bytesAdded += statSync(dest).size;
    audioPathRel = pathRelativeToData(dest);
    audioAbsDest = dest;
    audioChanged = true;
    needSegmentWaveformRegen = true;
  } else {
    const dest = segmentPath(podcastId, episodeId, segmentId, srcExt || "mp3");
    copyFileSync(audioSrc, dest);
    bytesAdded += statSync(dest).size;
    audioPathRel = pathRelativeToData(dest);
    audioAbsDest = dest;
    const currentAudioHash = sha256FileSync(dest);
    if (
      missingSegmentJson ||
      (typeof segMeta.audioSha256 === "string" &&
        segMeta.audioSha256 &&
        currentAudioHash &&
        currentAudioHash !== segMeta.audioSha256)
    ) {
      audioChanged = true;
      needSegmentWaveformRegen = true;
    } else if (!missingWaveformInZip) {
      const wavSrc = join(segDir, "waveform.json");
      const zipWavHash = sha256FileSync(wavSrc);
      if (
        typeof segMeta.waveformSha256 === "string" &&
        segMeta.waveformSha256 &&
        zipWavHash &&
        zipWavHash !== segMeta.waveformSha256
      ) {
        needSegmentWaveformRegen = true;
      } else {
        copyFileSync(wavSrc, waveformPath(dest));
        bytesAdded += statSync(waveformPath(dest)).size;
      }
    } else {
      needSegmentWaveformRegen = true;
    }
  }

  // Remove previous recorded audio if path differs
  if (oldAudio) {
    try {
      const prev = resolveDataPath(oldAudio);
      if (existsSync(prev) && audioAbsDest && prev !== audioAbsDest) {
        unlinkSync(prev);
        const prevWav = waveformPath(prev);
        if (existsSync(prevWav)) unlinkSync(prevWav);
      }
    } catch {
      // best-effort
    }
  }

  // Update row: keep id/position; set recorded with new audio + metadata from zip
  drizzleDb
    .update(episodeSegments)
    .set({
      type: "recorded",
      name: name == null ? null : String(name),
      reusableAssetId: null,
      audioPath: audioPathRel,
      durationSec,
      trimRanges:
        segMeta.trimRanges !== undefined
          ? stringifyJsonField(segMeta.trimRanges)
          : ((existing.trimRanges as string | null) ?? null),
      markers: stringifyJsonField(markers),
      audioEq:
        segMeta.audioEq !== undefined
          ? stringifyJsonField(segMeta.audioEq)
          : ((existing.audioEq as string | null) ?? null),
      disabled:
        segMeta.disabled !== undefined
          ? Boolean(segMeta.disabled)
          : Boolean(existing.disabled),
      inProgress: false,
      recordFailed: false,
    })
    .where(
      and(
        eq(episodeSegments.id, segmentId),
        eq(episodeSegments.episodeId, episodeId),
      ),
    )
    .run();

  // Replace multitrack dir
  if (oldMt && existsSync(oldMt)) {
    try {
      rmSync(oldMt, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }

  const recSrc = join(segDir, "recordings");
  let mtDest: string | null = null;
  let manifest: MultitrackManifest | null = null;
  let tracksChanged = false;
  if (existsSync(recSrc) && statSync(recSrc).isDirectory()) {
    let epochMs: number | undefined;
    const manifestSrc = join(recSrc, "tracks_manifest.json");
    if (existsSync(manifestSrc)) {
      try {
        manifest = rewriteManifestPaths(
          JSON.parse(readFileSync(manifestSrc, "utf8")),
        ) as MultitrackManifest;
        if (typeof manifest.recordingEpochMs === "number") {
          epochMs = manifest.recordingEpochMs;
        }
      } catch {
        manifest = null;
      }
    }
    mtDest = multitrackRecordingsDir(podcastId, episodeId, segmentId, epochMs);
    for (const fname of readdirSync(recSrc)) {
      const src = join(recSrc, fname);
      if (!statSync(src).isFile()) continue;
      if (fname === "tracks_manifest.json") continue;
      if (fname === HOST_DUCKING_FILENAME) continue;
      copyFileSync(src, join(mtDest, basename(fname)));
      bytesAdded += statSync(join(mtDest, basename(fname))).size;
    }
    const duckingSrc = join(segDir, HOST_DUCKING_FILENAME);
    if (existsSync(duckingSrc)) {
      copyFileSync(duckingSrc, join(mtDest, HOST_DUCKING_FILENAME));
      bytesAdded += statSync(join(mtDest, HOST_DUCKING_FILENAME)).size;
    }
    if (manifest) {
      tracksChanged = recordingsTracksChanged(mtDest, manifest);
      // Missing audio files = deleted tracks; drop them from the persisted manifest.
      manifest = pruneMissingManifestTracks(mtDest, manifest);
      writeFileSync(
        join(mtDest, "tracks_manifest.json"),
        JSON.stringify(manifest, null, 2),
      );
    }
  }

  if (timelineSidecarNeedsApply(segDir, segMeta.segmentRppSha256)) {
    let epochMs: number | undefined;
    if (manifest && typeof manifest.recordingEpochMs === "number") {
      epochMs = manifest.recordingEpochMs;
    }
    if (!mtDest) {
      mtDest = multitrackRecordingsDir(
        podcastId,
        episodeId,
        segmentId,
        epochMs,
      );
    }
    const applied = applyTimelineSidecarToManifest({
      segDir,
      mtDest,
      existingManifest: manifest,
    });
    if (applied.ok) {
      manifest = applied.manifest;
      bytesAdded += applied.bytesAdded;
      tracksChanged = true;
    } else {
      // Unreadable segment.rpp: keep tracks_manifest and remake from it.
      console.warn(
        `[projectImport] Ignoring segment.rpp (${applied.error}); using tracks_manifest.json`,
      );
      warning = REAPER_IGNORED_WARNING;
      if (manifest?.segments?.length) {
        tracksChanged = true;
      }
    }
  }

  if (tracksChanged && mtDest && manifest) {
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
    try {
      const duckingEnabled = Boolean(segMeta.hostDuckingEnabled);
      const ducking = duckingEnabled ? readHostDuckingFile(mtDest) : null;
      const remakeManifest = buildManifestForRemake(manifest, ducking, mtDest);
      const remade = await remakeMixFromMultitrackDir(
        mtDest,
        remakeManifest,
        mixDest,
        episodeUploads,
      );
      if (audioAbsDest && audioAbsDest !== mixDest && existsSync(audioAbsDest)) {
        try {
          unlinkSync(audioAbsDest);
        } catch {
          // ignore
        }
      }
      audioAbsDest = mixDest;
      audioPathRel = pathRelativeToData(mixDest);
      durationSec = remade.durationSec;
      markers = pruneMarkersForDuration(markers, durationSec);
      await audioService.generateWaveformFile(mixDest, episodeUploads);
      updateSegmentAudio(segmentId, episodeId, mixDest, durationSec, {
        markers: stringifyJsonField(markers) ?? "[]",
      });
      bytesAdded += statSync(mixDest).size;
      needSegmentWaveformRegen = false;
      audioChanged = false;
    } catch {
      needSegmentWaveformRegen = true;
    }
  }

  if (segMeta.hostDuckingEnabled !== undefined) {
    updateSegmentHostDuckingEnabled(
      segmentId,
      episodeId,
      Boolean(segMeta.hostDuckingEnabled),
    );
  }

  if (
    audioAbsDest &&
    existsSync(audioAbsDest) &&
    (needSegmentWaveformRegen || audioChanged || durationSec <= 0)
  ) {
    if (waveformsAvailable && (needSegmentWaveformRegen || audioChanged)) {
      try {
        await audioService.generateWaveformFile(audioAbsDest, episodeUploads);
      } catch {
        // non-fatal
      }
    }
    if (audioChanged || durationSec <= 0) {
      try {
        const probe = await audioService.probeAudio(
          audioAbsDest,
          episodeUploads,
        );
        durationSec = probe.durationSec;
        markers = pruneMarkersForDuration(markers, durationSec);
        updateSegmentAudio(segmentId, episodeId, audioAbsDest, durationSec, {
          markers: stringifyJsonField(markers) ?? "[]",
        });
      } catch {
        updateSegmentMarkers(
          segmentId,
          episodeId,
          stringifyJsonField(pruneMarkersForDuration(markers, durationSec)) ??
            "[]",
        );
      }
    }
  }

  const ownerId = getPodcastOwnerId(podcastId) ?? importerUserId;
  if (bytesAdded > 0) {
    addUserDiskBytes(ownerId, bytesAdded);
  }

  return { segmentId, bytesAdded, warning };
}

function resolveSegmentDir(extractRoot: string): string {
  const preferred = join(extractRoot, "segment");
  if (existsSync(preferred) && statSync(preferred).isDirectory()) {
    return preferred;
  }
  const segmentsDir = join(extractRoot, "segments");
  if (existsSync(segmentsDir) && statSync(segmentsDir).isDirectory()) {
    const folders = readdirSync(segmentsDir)
      .filter((n) => statSync(join(segmentsDir, n)).isDirectory())
      .sort();
    if (folders.length === 1) {
      return join(segmentsDir, folders[0]);
    }
    if (folders.length > 1) {
      throw new ImportValidationError(
        "Segment project has multiple segments/ folders; expected a single segment/",
      );
    }
  }
  throw new ImportValidationError("Missing segment/ directory in project zip");
}

/**
 * Import a kind:segment project zip, overwriting the target segment in place.
 */
export async function importSegmentProjectZip(
  podcastId: string,
  episodeId: string,
  segmentId: string,
  zipPath: string,
  importerUserId: string,
): Promise<SegmentImportResult> {
  const extractRoot = join(
    tmpdir(),
    `harborfm-segment-import-${nanoid()}`,
  );
  mkdirSync(extractRoot, { recursive: true });

  try {
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(extractRoot, true);

    const rootManifestPath = join(extractRoot, "harborfm-project.json");
    if (!existsSync(rootManifestPath)) {
      throw new ImportValidationError("Missing harborfm-project.json");
    }
    const rootManifest = readJsonFile<{
      formatVersion?: number;
      kind?: string;
    }>(rootManifestPath);
    if (rootManifest.formatVersion !== PROJECT_FORMAT_VERSION) {
      throw new ImportValidationError(
        `Unsupported project formatVersion (expected ${PROJECT_FORMAT_VERSION})`,
      );
    }
    if (rootManifest.kind !== "segment") {
      throw new ImportValidationError(
        'This zip is not a segment project (expected kind: "segment")',
      );
    }

    const segDir = resolveSegmentDir(extractRoot);
    const libraryRoot = join(extractRoot, "library");
    return await applySegmentFolderOntoExisting({
      podcastId,
      episodeId,
      segmentId,
      segDir,
      libraryRoot: existsSync(libraryRoot) ? libraryRoot : null,
      importerUserId,
    });
  } finally {
    try {
      rmSync(extractRoot, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
}

export type SegmentProjectImportStatus = "idle" | "importing" | "done" | "failed";

const importStatusBySegment = new Map<string, "importing" | "done" | "failed">();
const importErrorBySegment = new Map<string, string>();
const importWarningBySegment = new Map<string, string>();

/**
 * Start a background segment project import. Returns false if already importing
 * for this segment. Caller must have written tmpZip; this owns cleanup.
 */
export function startSegmentProjectImport(
  podcastId: string,
  episodeId: string,
  segmentId: string,
  tmpZip: string,
  importerUserId: string,
  onSuccess?: () => void,
): boolean {
  if (importStatusBySegment.get(segmentId) === "importing") return false;
  importStatusBySegment.set(segmentId, "importing");
  importErrorBySegment.delete(segmentId);
  importWarningBySegment.delete(segmentId);
  setImmediate(() => {
    void importSegmentProjectZip(
      podcastId,
      episodeId,
      segmentId,
      tmpZip,
      importerUserId,
    )
      .then((result) => {
        if (result.warning) {
          importWarningBySegment.set(segmentId, result.warning);
        }
        importStatusBySegment.set(segmentId, "done");
        onSuccess?.();
      })
      .catch((err: unknown) => {
        importStatusBySegment.set(segmentId, "failed");
        const message =
          err instanceof ImportValidationError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Failed to import project";
        importErrorBySegment.set(segmentId, message);
      })
      .finally(() => {
        removeTempPath(tmpZip);
      });
  });
  return true;
}

/** Status for import poll. Clears done/failed on read. */
export function getSegmentProjectImportStatus(segmentId: string): {
  status: SegmentProjectImportStatus;
  error?: string;
  warning?: string;
} {
  const status = importStatusBySegment.get(segmentId);
  if (!status) return { status: "idle" };
  if (status === "importing") return { status: "importing" };
  const error = importErrorBySegment.get(segmentId);
  const warning = importWarningBySegment.get(segmentId);
  importStatusBySegment.delete(segmentId);
  importErrorBySegment.delete(segmentId);
  importWarningBySegment.delete(segmentId);
  if (status === "failed") return { status: "failed", error };
  return { status: "done", warning };
}
