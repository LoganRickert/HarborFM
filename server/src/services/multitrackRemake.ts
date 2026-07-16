import { execFile } from "child_process";
import { promisify } from "util";
import { basename, join, resolve } from "path";
import { existsSync, mkdirSync, statSync } from "fs";
import { FFMPEG_PATH } from "../config.js";
import { assertPathUnder, assertResolvedPathUnder } from "./paths.js";
import * as audioService from "./audio.js";

const exec = promisify(execFile);

/** LUFS target matching webrtc-service RecordingManager.runAmixAndDeliver. */
const SEGMENT_LOUDNESS_TARGET_LUFS = -18;
const MIN_SEGMENT_BYTES = 1024;

export type MultitrackSegmentEntry = {
  segmentId?: string;
  startMs?: number;
  endMs?: number;
  filePath?: string;
  volume?: number;
  fileSha256?: string;
  waveformSha256?: string;
};

export type MultitrackManifest = {
  recordingEpochMs?: number;
  sessionStartedAtEpochMs?: number;
  segments?: MultitrackSegmentEntry[];
  [key: string]: unknown;
};

function resolveTrackPath(mtDir: string, entry: MultitrackSegmentEntry): string | null {
  const rel = entry.filePath;
  if (!rel || typeof rel !== "string") return null;
  const base = basename(rel.replace(/\\/g, "/"));
  const full = join(mtDir, base);
  return existsSync(full) ? full : null;
}

/**
 * Remake the segment mix WAV from multitrack MP3s + tracks_manifest
 * (same loudnorm/amix rules as webrtc RecordingManager.runAmixAndDeliver).
 */
export async function remakeMixFromMultitrackDir(
  mtDir: string,
  manifest: MultitrackManifest,
  outWavPath: string,
  allowedBaseDir: string,
): Promise<{ durationSec: number }> {
  assertPathUnder(mtDir, allowedBaseDir);
  // Output may not exist yet; validate resolved path under allowed base.
  assertResolvedPathUnder(outWavPath, allowedBaseDir);
  const safeOut = resolve(outWavPath);
  mkdirSync(join(safeOut, ".."), { recursive: true });
  const segments = Array.isArray(manifest.segments) ? manifest.segments : [];
  if (segments.length === 0) {
    throw new Error("tracks_manifest has no segments to mix");
  }

  const usable = segments
    .map((s) => {
      const path = resolveTrackPath(mtDir, s);
      if (!path) return null;
      const size = statSync(path).size;
      if (size < MIN_SEGMENT_BYTES) return null;
      return { entry: s, path };
    })
    .filter((x): x is { entry: MultitrackSegmentEntry; path: string } => x != null);

  if (usable.length === 0) {
    throw new Error("No usable multitrack files to mix");
  }

  if (usable.length === 1) {
    const only = usable[0];
    const vol =
      only.entry.volume != null && only.entry.volume !== 1 ? only.entry.volume : 1;
    const afParts =
      vol !== 1
        ? [`volume=${vol}`, `loudnorm=I=${SEGMENT_LOUDNESS_TARGET_LUFS}:TP=-1:LRA=14`]
        : [`loudnorm=I=${SEGMENT_LOUDNESS_TARGET_LUFS}:TP=-1:LRA=14`];
    await exec(
      FFMPEG_PATH,
      [
        "-loglevel",
        "warning",
        "-i",
        only.path,
        "-af",
        afParts.join(","),
        "-acodec",
        "pcm_s16le",
        "-ar",
        "48000",
        "-ac",
        "1",
        "-y",
        safeOut,
      ],
      { maxBuffer: 8 * 1024 * 1024 },
    );
  } else {
    let recordingDurationMs = 0;
    for (const u of usable) {
      const endMs = typeof u.entry.endMs === "number" ? u.entry.endMs : 0;
      if (endMs > recordingDurationMs) recordingDurationMs = endMs;
    }
    if (recordingDurationMs <= 0) {
      // Fallback: use longest probed duration + start offset
      for (const u of usable) {
        const startMs = typeof u.entry.startMs === "number" ? u.entry.startMs : 0;
        try {
          const probe = await audioService.probeAudio(u.path, allowedBaseDir);
          const endMs = startMs + Math.round(probe.durationSec * 1000);
          if (endMs > recordingDurationMs) recordingDurationMs = endMs;
        } catch {
          // ignore
        }
      }
    }

    const filterParts: string[] = [];
    const inputArgs: string[] = [];
    let inputIdx = 0;
    for (const u of usable) {
      const startMs = typeof u.entry.startMs === "number" ? u.entry.startMs : 0;
      const delayMs = Math.max(0, Math.round(startMs));
      const padDurationMs = Math.max(0, recordingDurationMs - delayMs);
      const padDurationSec = (padDurationMs / 1000).toFixed(3);
      inputArgs.push("-i", u.path);
      const volPart =
        u.entry.volume != null && u.entry.volume !== 1
          ? `,volume=${u.entry.volume}`
          : "";
      filterParts.push(
        `[${inputIdx}:a]adelay=${delayMs}|${delayMs},apad=whole_dur=${padDurationSec}${volPart}[a${inputIdx}]`,
      );
      inputIdx++;
    }

    const amixInputs = Array.from({ length: inputIdx }, (_, i) => `[a${i}]`).join("");
    const filterComplex =
      filterParts.join(";") +
      ";" +
      `${amixInputs}amix=inputs=${inputIdx}:duration=longest:dropout_transition=500[aout];` +
      `[aout]loudnorm=I=${SEGMENT_LOUDNESS_TARGET_LUFS}:TP=-1:LRA=14[out]`;

    await exec(
      FFMPEG_PATH,
      [
        "-loglevel",
        "warning",
        ...inputArgs,
        "-filter_complex",
        filterComplex,
        "-map",
        "[out]",
        "-acodec",
        "pcm_s16le",
        "-ar",
        "48000",
        "-ac",
        "1",
        "-y",
        safeOut,
      ],
      { maxBuffer: 16 * 1024 * 1024 },
    );
  }

  if (!existsSync(safeOut) || statSync(safeOut).size <= 0) {
    throw new Error("ffmpeg mix produced empty output");
  }
  const probe = await audioService.probeAudio(safeOut, allowedBaseDir);
  return { durationSec: probe.durationSec };
}

/** Keep markers whose end time is within durationSec (soundbites use time+duration). */
export function pruneMarkersForDuration(
  markers: unknown,
  durationSec: number,
): unknown {
  if (!Array.isArray(markers)) return markers;
  const max = Math.max(0, durationSec);
  return markers.filter((m) => {
    if (!m || typeof m !== "object") return false;
    const time = Number((m as { time?: unknown }).time);
    if (!Number.isFinite(time) || time < 0 || time > max) return false;
    const dur = Number((m as { duration?: unknown }).duration);
    if (Number.isFinite(dur) && dur > 0) {
      return time + dur <= max;
    }
    return true;
  });
}
