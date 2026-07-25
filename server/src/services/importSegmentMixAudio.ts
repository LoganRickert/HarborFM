import { existsSync, unlinkSync, statSync, renameSync } from "fs";
import { basename, dirname, extname, join } from "path";
import { getPodcastOwnerId } from "./access.js";
import * as audioService from "./audio.js";
import {
  assertPathUnder,
  pathRelativeToData,
  resolveDataPath,
  segmentPath,
  uploadsDir,
} from "./paths.js";
import { wouldExceedStorageLimit } from "./storageLimit.js";
import { drizzleDb } from "../db/index.js";
import { pruneMarkersForDuration } from "./multitrackRemake.js";
import { waveformPath } from "../modules/segments/utils.js";
import * as repo from "../modules/segments/repo.js";

/**
 * Replace a recorded segment's final mix with an uploaded audio file
 * (e.g. Download MP3 → enhance externally → Import MP3).
 *
 * Clears soft trims and EQ because Download MP3 already bakes those into the
 * export; keeping them would double-apply on the next download/render.
 * Prunes markers to the new duration. Does not change tracks_manifest;
 * Remake from tracks will overwrite this mix again.
 */
export async function importSegmentMixAudio(opts: {
  podcastId: string;
  episodeId: string;
  segmentId: string;
  /** Absolute path to the uploaded file under episode uploads. */
  uploadPath: string;
  inputExt: string;
}): Promise<{ durationSec: number; audioPath: string }> {
  const { podcastId, episodeId, segmentId, uploadPath, inputExt } = opts;
  const segmentBase = uploadsDir(podcastId, episodeId);
  assertPathUnder(uploadPath, segmentBase);

  const existing = repo.getSegmentById(segmentId, episodeId);
  if (!existing || existing.type !== "recorded") {
    throw new Error("Only recorded segments can import a mix");
  }

  const ownerId = getPodcastOwnerId(podcastId);
  if (!ownerId) {
    throw new Error("Podcast owner not found");
  }

  const normalized = await audioService.normalizeUploadToMp3OrWav(
    uploadPath,
    inputExt,
    segmentBase,
  );
  const normalizedPath = normalized.path;
  assertPathUnder(normalizedPath, segmentBase);

  const destPath = segmentPath(
    podcastId,
    episodeId,
    segmentId,
    normalized.ext || "mp3",
  );
  assertPathUnder(destPath, segmentBase);

  // Move normalized file onto the canonical segment filename.
  if (normalizedPath !== destPath) {
    renameSync(normalizedPath, destPath);
  }

  const newBytes = statSync(destPath).size;
  if (newBytes <= 0) {
    try {
      unlinkSync(destPath);
    } catch {
      /* ignore */
    }
    throw new Error("Imported audio file is empty");
  }

  const oldRel =
    existing && typeof existing.audioPath === "string"
      ? existing.audioPath
      : null;
  let oldBytes = 0;
  let oldAbs: string | null = null;
  if (oldRel) {
    try {
      oldAbs = resolveDataPath(oldRel);
      if (existsSync(oldAbs) && oldAbs !== destPath) {
        assertPathUnder(oldAbs, segmentBase);
        oldBytes = statSync(oldAbs).size;
      } else {
        oldAbs = null;
      }
    } catch {
      oldAbs = null;
      oldBytes = 0;
    }
  }

  const delta = newBytes - oldBytes;
  if (delta > 0 && wouldExceedStorageLimit(drizzleDb, ownerId, delta)) {
    try {
      unlinkSync(destPath);
    } catch {
      /* ignore */
    }
    throw new Error(
      "You have reached your storage limit. Delete some content to free space.",
    );
  }

  if (oldAbs) {
    try {
      unlinkSync(oldAbs);
      const prevWf = waveformPath(oldAbs);
      if (existsSync(prevWf)) unlinkSync(prevWf);
    } catch {
      // best-effort
    }
  }

  // Drop orphan next to dest if normalize left a sibling waveform for the temp name.
  try {
    const normWf = waveformPath(
      join(dirname(destPath), basename(normalizedPath)),
    );
    if (existsSync(normWf) && normWf !== waveformPath(destPath)) {
      unlinkSync(normWf);
    }
  } catch {
    // ignore
  }

  let durationSec = 0;
  try {
    const probe = await audioService.probeAudio(destPath, segmentBase);
    durationSec = Math.max(0, probe.durationSec);
  } catch {
    durationSec = 0;
  }

  try {
    await audioService.generateWaveformFile(destPath, segmentBase);
  } catch {
    // best-effort; mix still usable
  }

  let markers: unknown = existing.markers ?? [];
  if (typeof markers === "string" && markers) {
    try {
      markers = JSON.parse(markers);
    } catch {
      markers = [];
    }
  }
  markers = pruneMarkersForDuration(markers, durationSec);

  repo.updateSegmentAudio(segmentId, episodeId, destPath, durationSec, {
    trimRanges: "[]",
    markers: JSON.stringify(markers ?? []),
  });
  repo.updateSegmentAudioEq(segmentId, episodeId, null);

  if (delta !== 0) {
    repo.addUserDiskBytes(ownerId, delta);
  }

  return {
    durationSec,
    audioPath: pathRelativeToData(destPath),
  };
}

/** Best-effort cleanup of a temp upload path and its extension variants. */
export function cleanupImportUpload(path: string): void {
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {
    /* ignore */
  }
  try {
    const base = path.slice(0, path.length - extname(path).length);
    for (const ext of [".mp3", ".wav", ".webm", ".m4a", ".ogg"]) {
      const p = base + ext;
      if (p !== path && existsSync(p)) unlinkSync(p);
    }
  } catch {
    /* ignore */
  }
}
