import {
  existsSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { basename, join } from "path";
import {
  resolveDataPath,
  segmentPath,
  uploadsDir,
} from "./paths.js";
import * as audioService from "./audio.js";
import {
  pruneMarkersForDuration,
  remakeMixFromMultitrackDir,
  type MultitrackManifest,
} from "./multitrackRemake.js";
import {
  buildManifestForRemake,
  generateAndWriteHostDucking,
  readHostDuckingFile,
  type HostDuckingFile,
} from "./hostDucking.js";
import { findMultitrackDir } from "../modules/episodes/projectSegmentPack.js";
import {
  getSegmentById,
  updateSegmentAudio,
  updateSegmentHostDuckingEnabled,
} from "../modules/segments/repo.js";
import { sha256FileSync } from "../utils/hash.js";
import { waveformPath } from "../modules/segments/utils.js";

function loadManifest(mtDir: string): MultitrackManifest | null {
  const path = join(mtDir, "tracks_manifest.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as MultitrackManifest;
  } catch {
    return null;
  }
}

async function ensureTrackWaveforms(mtDir: string): Promise<void> {
  const manifest = loadManifest(mtDir);
  const entries = Array.isArray(manifest?.segments) ? manifest!.segments! : [];
  for (const entry of entries) {
    const rel = typeof entry.filePath === "string" ? entry.filePath : null;
    if (!rel) continue;
    const trackAbs = join(mtDir, basename(rel.replace(/\\/g, "/")));
    if (!existsSync(trackAbs)) continue;
    if (existsSync(waveformPath(trackAbs))) continue;
    try {
      await audioService.generateWaveformFile(trackAbs, mtDir);
    } catch {
      // best-effort
    }
  }
}

/**
 * Remake segment mix from multitrack, optionally applying host ducking gates.
 * Updates segment audio path/duration and optionally hostDuckingEnabled.
 */
export async function remakeSegmentWithHostDucking(opts: {
  podcastId: string;
  episodeId: string;
  segmentId: string;
  /** When true, generate/use host_ducking.json and gate hosts. */
  applyDucking: boolean;
  /** Persist hostDuckingEnabled on the segment row. */
  setEnabledFlag?: boolean;
  /** Regenerate host_ducking.json even if present. */
  regenerateDucking?: boolean;
}): Promise<{ durationSec: number; ducking: HostDuckingFile | null }> {
  const {
    podcastId,
    episodeId,
    segmentId,
    applyDucking,
    setEnabledFlag,
    regenerateDucking,
  } = opts;

  const mtDir = findMultitrackDir(podcastId, episodeId, segmentId);
  if (!mtDir) {
    throw new Error("No multitrack recordings for this segment");
  }
  const manifest = loadManifest(mtDir);
  if (
    !manifest ||
    !Array.isArray(manifest.segments) ||
    manifest.segments.length === 0
  ) {
    throw new Error("tracks_manifest.json missing or empty");
  }

  await ensureTrackWaveforms(mtDir);

  let ducking: HostDuckingFile | null = null;
  if (applyDucking) {
    if (regenerateDucking || !readHostDuckingFile(mtDir)) {
      ducking = generateAndWriteHostDucking(mtDir, manifest);
    } else {
      ducking = readHostDuckingFile(mtDir);
    }
  }

  const remakeManifest = buildManifestForRemake(manifest, ducking, mtDir);
  const episodeUploads = uploadsDir(podcastId, episodeId);
  const mixDest = segmentPath(podcastId, episodeId, segmentId, "wav");
  const remade = await remakeMixFromMultitrackDir(
    mtDir,
    remakeManifest,
    mixDest,
    episodeUploads,
  );

  const existing = getSegmentById(segmentId, episodeId);
  let markers: unknown = existing?.markers ?? [];
  if (typeof markers === "string" && markers) {
    try {
      markers = JSON.parse(markers);
    } catch {
      markers = [];
    }
  }
  markers = pruneMarkersForDuration(markers, remade.durationSec);

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
  });
  if (setEnabledFlag !== undefined) {
    updateSegmentHostDuckingEnabled(segmentId, episodeId, setEnabledFlag);
  }

  for (const entry of manifest.segments ?? []) {
    const rel = typeof entry.filePath === "string" ? entry.filePath : null;
    if (!rel) continue;
    const trackAbs = join(mtDir, basename(rel.replace(/\\/g, "/")));
    if (!existsSync(trackAbs)) continue;
    entry.fileSha256 = sha256FileSync(trackAbs) ?? entry.fileSha256;
    entry.waveformSha256 =
      sha256FileSync(waveformPath(trackAbs)) ?? entry.waveformSha256;
  }
  writeFileSync(
    join(mtDir, "tracks_manifest.json"),
    JSON.stringify(manifest, null, 2),
  );

  return { durationSec: remade.durationSec, ducking };
}

export type HostDuckingJobStatus = "idle" | "remaking" | "done" | "failed";

const jobStatusBySegment = new Map<string, "remaking" | "done" | "failed">();
const jobErrorBySegment = new Map<string, string>();

/**
 * Start a background host-ducking remake. Returns false if already remaking
 * for this segment.
 */
export function startHostDuckingJob(opts: {
  podcastId: string;
  episodeId: string;
  segmentId: string;
  enabled: boolean;
  onSuccess?: () => void;
}): boolean {
  const { podcastId, episodeId, segmentId, enabled, onSuccess } = opts;
  if (jobStatusBySegment.get(segmentId) === "remaking") return false;
  jobStatusBySegment.set(segmentId, "remaking");
  jobErrorBySegment.delete(segmentId);
  setImmediate(() => {
    void remakeSegmentWithHostDucking({
      podcastId,
      episodeId,
      segmentId,
      applyDucking: enabled,
      setEnabledFlag: enabled,
      regenerateDucking: enabled,
    })
      .then(() => {
        jobStatusBySegment.set(segmentId, "done");
        onSuccess?.();
      })
      .catch((err: unknown) => {
        console.error("[hostDucking] remake failed", {
          podcastId,
          episodeId,
          segmentId,
          enabled,
          err,
        });
        jobStatusBySegment.set(segmentId, "failed");
        // Never send ffmpeg stderr / paths / filter graphs to the client.
        jobErrorBySegment.set(segmentId, "Failed to apply host ducking");
      });
  });
  return true;
}

/** Status for host-ducking poll. Clears done/failed on read. */
export function getHostDuckingJobStatus(segmentId: string): {
  status: HostDuckingJobStatus;
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
