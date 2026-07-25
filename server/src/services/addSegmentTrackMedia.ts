import { copyFileSync, existsSync, unlinkSync } from "fs";
import { basename, extname, join } from "path";
import { nanoid } from "nanoid";
import { LIBRARY_UPLOAD_MAX_BYTES } from "../config.js";
import { canReadLibraryAsset } from "./access.js";
import * as audioService from "./audio.js";
import {
  assertPathUnder,
  libraryDir,
  resolveDataPath,
} from "./paths.js";
import { findMultitrackDir } from "../modules/episodes/projectSegmentPack.js";
import { getById as getLibraryAsset } from "../modules/library/repo.js";
import {
  extensionFromAudioMimetype,
  FileTooLargeError,
  streamToFileWithLimit,
} from "./uploads.js";

export type AddSegmentTrackMediaResult = {
  filePath: string;
  durationMs: number;
  participantName: string;
};

function safeTrackBasename(name: string, ext: string): string {
  const cleaned = name
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  const base = cleaned || "track";
  return `${base}_${nanoid(8)}.${ext}`;
}

/**
 * Copy an uploaded file or library asset into the segment recordings folder
 * for advanced editor "Add track".
 */
export async function addSegmentTrackMedia(opts: {
  podcastId: string;
  episodeId: string;
  segmentId: string;
  userId: string;
  trackName?: string | null;
  libraryAssetId?: string | null;
  upload?: {
    file: NodeJS.ReadableStream;
    mimetype: string;
    filename?: string;
  } | null;
}): Promise<AddSegmentTrackMediaResult> {
  const mtDir = findMultitrackDir(
    opts.podcastId,
    opts.episodeId,
    opts.segmentId,
  );
  if (!mtDir) {
    throw new Error("No multitrack recordings for this segment");
  }

  let destPath = "";
  let participantName =
    typeof opts.trackName === "string" && opts.trackName.trim()
      ? opts.trackName.trim()
      : "Track";

  try {
    if (opts.libraryAssetId) {
      if (!canReadLibraryAsset(opts.userId, opts.libraryAssetId)) {
        throw new Error("Library asset not found");
      }
      const asset = getLibraryAsset(opts.libraryAssetId);
      if (!asset) throw new Error("Library asset not found");
      const assetPath = resolveDataPath(asset.audioPath);
      if (!existsSync(assetPath)) {
        throw new Error("Library asset audio not found");
      }
      assertPathUnder(assetPath, libraryDir(asset.ownerUserId));
      if (
        typeof opts.trackName !== "string" ||
        !opts.trackName.trim()
      ) {
        participantName =
          typeof asset.name === "string" && asset.name.trim()
            ? asset.name.trim()
            : "Track";
      }
      const ext =
        (extname(assetPath).replace(/^\./, "") || "mp3").toLowerCase();
      destPath = join(mtDir, safeTrackBasename(participantName, ext));
      copyFileSync(assetPath, destPath);
    } else if (opts.upload) {
      const mimetype = opts.upload.mimetype || "";
      if (
        !mimetype.startsWith("audio/") &&
        !mimetype.includes("wav") &&
        !mimetype.includes("mpeg")
      ) {
        throw new Error("Invalid file type. Use WAV, MP3, or WebM.");
      }
      const ext = extensionFromAudioMimetype(mimetype);
      const fromName =
        opts.upload.filename?.replace(/\.[^.]+$/, "")?.trim() || "Track";
      if (
        typeof opts.trackName !== "string" ||
        !opts.trackName.trim()
      ) {
        participantName = fromName.slice(0, 80);
      }
      const rawPath = join(mtDir, safeTrackBasename(participantName, ext));
      try {
        await streamToFileWithLimit(
          opts.upload.file,
          rawPath,
          LIBRARY_UPLOAD_MAX_BYTES,
        );
      } catch (err) {
        if (err instanceof FileTooLargeError) {
          throw new Error("File too large");
        }
        throw err;
      }
      const normalized = await audioService.normalizeUploadToMp3OrWav(
        rawPath,
        ext,
        mtDir,
      );
      destPath = normalized.path;
      if (rawPath !== destPath && existsSync(rawPath)) {
        try {
          unlinkSync(rawPath);
        } catch {
          // ignore
        }
      }
    } else {
      throw new Error("Upload a file or choose a library asset");
    }

    assertPathUnder(destPath, mtDir);
    try {
      await audioService.generateWaveformFile(destPath, mtDir);
    } catch {
      // Waveform is best-effort; preview still works.
    }

    let durationMs = 0;
    try {
      const floatDur = await audioService.probeAudioDurationFloat(
        destPath,
        mtDir,
      );
      durationMs = Math.max(1, Math.round(floatDur * 1000));
    } catch {
      try {
        const probe = await audioService.probeAudio(destPath, mtDir);
        durationMs = Math.max(1, Math.round(probe.durationSec * 1000));
      } catch {
        durationMs = 1000;
      }
    }

    return {
      filePath: basename(destPath),
      durationMs,
      participantName,
    };
  } catch (err) {
    if (destPath && existsSync(destPath)) {
      try {
        unlinkSync(destPath);
      } catch {
        // ignore
      }
    }
    throw err;
  }
}
