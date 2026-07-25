import {
  copyFileSync,
  existsSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { extname, join } from "path";
import { drizzleDb } from "../db/drizzle.js";
import { getPodcastOwnerId } from "./access.js";
import * as audioService from "./audio.js";
import {
  multitrackRecordingsDir,
  uploadsDir,
} from "./paths.js";
import { wouldExceedStorageLimit } from "./storageLimit.js";
import { findMultitrackDir } from "../modules/episodes/projectSegmentPack.js";
import { TRACKS_MANIFEST_NAME } from "../modules/episodes/projectSegmentShared.js";
import * as repo from "../modules/segments/repo.js";
import { waveformPath } from "../modules/segments/utils.js";
import type { MultitrackManifest } from "./multitrackRemake.js";

export class BootstrapMultitrackError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "BootstrapMultitrackError";
    this.statusCode = statusCode;
  }
}

export type BootstrapSegmentMultitrackResult = {
  hasRecordings: true;
  alreadyExisted: boolean;
  bytesAdded: number;
  mtDir: string;
  takeFile: string;
};

function cleanupMtDir(mtDir: string): void {
  try {
    rmSync(mtDir, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
}

/**
 * Copy a recorded segment's mix audio (+ waveform) into recordings/ as a
 * single-track layout so the advanced editor can open. Charges the podcast
 * owner for the newly copied take and waveform bytes.
 */
export async function bootstrapSegmentMultitrackFromMix(opts: {
  podcastId: string;
  episodeId: string;
  segmentId: string;
}): Promise<BootstrapSegmentMultitrackResult> {
  const { podcastId, episodeId, segmentId } = opts;
  const row = repo.getSegmentById(segmentId, episodeId);
  if (!row) {
    throw new BootstrapMultitrackError("Segment not found", 404);
  }
  if (row.type !== "recorded") {
    throw new BootstrapMultitrackError(
      "Only recorded segments can open the advanced editor from mix audio",
      400,
    );
  }
  if (row.inProgress) {
    throw new BootstrapMultitrackError(
      "Wait for recording to finish before opening the advanced editor",
      400,
    );
  }

  const existing = findMultitrackDir(podcastId, episodeId, segmentId);
  if (existing) {
    const manifestPath = join(existing, TRACKS_MANIFEST_NAME);
    if (existsSync(manifestPath)) {
      return {
        hasRecordings: true,
        alreadyExisted: true,
        bytesAdded: 0,
        mtDir: existing,
        takeFile: "",
      };
    }
    // Incomplete prior attempt (empty / partial dir): remove and recreate.
    cleanupMtDir(existing);
  }

  const audio = repo.getSegmentAudioPath(row, podcastId, episodeId);
  if (!audio || !existsSync(audio.path)) {
    throw new BootstrapMultitrackError(
      "No mix audio found for this segment",
      404,
    );
  }

  const ownerId = getPodcastOwnerId(podcastId);
  if (!ownerId) {
    throw new BootstrapMultitrackError("Podcast owner not found", 500);
  }

  const ext = (extname(audio.path).replace(/^\./, "") || "wav").toLowerCase();
  const takeFile = `mix.${ext}`;
  const mtDir = multitrackRecordingsDir(podcastId, episodeId, segmentId);
  const takeAbs = join(mtDir, takeFile);
  const episodeUploads = uploadsDir(podcastId, episodeId);

  try {
    copyFileSync(audio.path, takeAbs);

    const mixWf = waveformPath(audio.path);
    const takeWf = waveformPath(takeAbs);
    if (existsSync(mixWf)) {
      copyFileSync(mixWf, takeWf);
    } else {
      try {
        await audioService.generateWaveformFile(takeAbs, mtDir);
      } catch {
        /* best-effort; take can still open without waveform */
      }
    }

    let endMs = Math.max(
      1000,
      Math.round((Number(row.durationSec) || 0) * 1000),
    );
    try {
      const probe = await audioService.probeAudio(takeAbs, episodeUploads);
      if (probe.durationSec > 0) {
        endMs = Math.max(1000, Math.round(probe.durationSec * 1000));
      }
    } catch {
      /* keep duration from segment row */
    }

    const epoch = Date.now();
    const manifest: MultitrackManifest = {
      recordingEpochMs: epoch,
      sessionStartedAtEpochMs: epoch,
      episodeId,
      podcastId,
      segments: [
        {
          segmentId: "mix-clip",
          participantName: "Mix",
          participantId: "mix",
          startMs: 0,
          endMs,
          lengthMs: endMs,
          sourceOffsetMs: 0,
          filePath: takeFile,
        },
      ],
    };
    writeFileSync(
      join(mtDir, TRACKS_MANIFEST_NAME),
      JSON.stringify(manifest, null, 2),
    );

    const takeBytes = existsSync(takeAbs) ? statSync(takeAbs).size : 0;
    const wfBytes = existsSync(takeWf) ? statSync(takeWf).size : 0;
    const bytesAdded = takeBytes + wfBytes;

    if (bytesAdded > 0 && wouldExceedStorageLimit(drizzleDb, ownerId, bytesAdded)) {
      cleanupMtDir(mtDir);
      throw new BootstrapMultitrackError("Storage limit exceeded", 403);
    }

    if (bytesAdded > 0) {
      repo.addUserDiskBytes(ownerId, bytesAdded);
    }

    return {
      hasRecordings: true,
      alreadyExisted: false,
      bytesAdded,
      mtDir,
      takeFile,
    };
  } catch (err) {
    if (err instanceof BootstrapMultitrackError) throw err;
    cleanupMtDir(mtDir);
    const message =
      err instanceof Error && err.message
        ? err.message
        : "Failed to bootstrap advanced editor from mix audio";
    throw new BootstrapMultitrackError(message, 500);
  }
}

/** True when the segment has mix audio on disk and no usable multitrack folder yet. */
export function canBootstrapAdvancedEditorFromMix(
  podcastId: string,
  episodeId: string,
  segment: Record<string, unknown>,
): boolean {
  if (segment.type !== "recorded") return false;
  if (segment.inProgress || segment.recordFailed) return false;
  const existing = findMultitrackDir(podcastId, episodeId, segment.id as string);
  if (existing && existsSync(join(existing, TRACKS_MANIFEST_NAME))) {
    return false;
  }
  const audio = repo.getSegmentAudioPath(segment, podcastId, episodeId);
  return Boolean(audio && existsSync(audio.path));
}
