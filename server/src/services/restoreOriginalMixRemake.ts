import { existsSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { resolveDataPath, segmentPath, uploadsDir } from "./paths.js";
import * as audioService from "./audio.js";
import {
  pruneMarkersForDuration,
  pruneTrimRangesForDuration,
  remakeMixFromMultitrackDir,
} from "./multitrackRemake.js";
import {
  buildManifestForRemake,
  readHostDuckingFile,
} from "./hostDucking.js";
import { findMultitrackDir } from "../modules/episodes/projectSegmentPack.js";
import {
  refreshMultitrackTrackSidecars,
  restoreOriginalTracksManifest,
} from "../modules/episodes/projectSegmentShared.js";
import {
  getSegmentById,
  updateSegmentAudio,
} from "../modules/segments/repo.js";
import { waveformPath } from "../modules/segments/utils.js";

/**
 * Restore tracks_manifest.json from tracks_manifest.json.original and remake
 * the segment mix (ignoring OTIO / Reaper layout changes).
 */
export async function remakeSegmentFromOriginalManifest(opts: {
  podcastId: string;
  episodeId: string;
  segmentId: string;
}): Promise<{ durationSec: number }> {
  const { podcastId, episodeId, segmentId } = opts;

  const mtDir = findMultitrackDir(podcastId, episodeId, segmentId);
  if (!mtDir) {
    throw new Error("No multitrack recordings for this segment");
  }

  const manifest = restoreOriginalTracksManifest(mtDir);

  await refreshMultitrackTrackSidecars(mtDir, manifest, {
    generateWaveforms: false,
  });
  writeFileSync(
    join(mtDir, "tracks_manifest.json"),
    JSON.stringify(manifest, null, 2),
  );

  const existing = getSegmentById(segmentId, episodeId);
  const duckingEnabled = Boolean(existing?.hostDuckingEnabled);
  const ducking = duckingEnabled ? readHostDuckingFile(mtDir) : null;
  const remakeManifest = buildManifestForRemake(manifest, ducking, mtDir);

  const episodeUploads = uploadsDir(podcastId, episodeId);
  const mixDest = segmentPath(podcastId, episodeId, segmentId, "wav");
  const remade = await remakeMixFromMultitrackDir(
    mtDir,
    remakeManifest,
    mixDest,
    episodeUploads,
  );

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

export type RestoreOriginalMixJobStatus =
  | "idle"
  | "remaking"
  | "done"
  | "failed";

const jobStatusBySegment = new Map<string, "remaking" | "done" | "failed">();
const jobErrorBySegment = new Map<string, string>();

/**
 * Start a background restore-original-mix remake. Returns false if already remaking.
 */
export function startRestoreOriginalMixJob(opts: {
  podcastId: string;
  episodeId: string;
  segmentId: string;
  onSuccess?: () => void;
}): boolean {
  const { podcastId, episodeId, segmentId, onSuccess } = opts;
  if (jobStatusBySegment.get(segmentId) === "remaking") return false;
  jobStatusBySegment.set(segmentId, "remaking");
  jobErrorBySegment.delete(segmentId);
  setImmediate(() => {
    void remakeSegmentFromOriginalManifest({
      podcastId,
      episodeId,
      segmentId,
    })
      .then(() => {
        jobStatusBySegment.set(segmentId, "done");
        onSuccess?.();
      })
      .catch((err: unknown) => {
        console.error("[restoreOriginalMix] remake failed", {
          podcastId,
          episodeId,
          segmentId,
          err,
        });
        jobStatusBySegment.set(segmentId, "failed");
        const message =
          err instanceof Error && err.message
            ? err.message
            : "Failed to restore original mix";
        // Prefer known user-facing messages; hide ffmpeg internals.
        const safe =
          message.startsWith("No original") ||
          message.startsWith("No multitrack") ||
          message.startsWith("Original tracks")
            ? message
            : "Failed to restore original mix";
        jobErrorBySegment.set(segmentId, safe);
      });
  });
  return true;
}

/** Status for restore-original-mix poll. Clears done/failed on read. */
export function getRestoreOriginalMixJobStatus(segmentId: string): {
  status: RestoreOriginalMixJobStatus;
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
