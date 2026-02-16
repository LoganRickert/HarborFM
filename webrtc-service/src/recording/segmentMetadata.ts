import { appendFileSync, existsSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync } from "fs";
import { join, resolve, sep } from "path";
import type { SegmentStatus } from "./recordingTypes.js";
import { isSafeDirectoryName, isSafeFileName } from "../validation.js";

/** Segment IDs must match nanoid-style pattern for safe log output. */
const SAFE_ID = /^[a-zA-Z0-9_-]+$/;

const RECOVERY_SIZE_THRESHOLD = 16384;

export function appendSegmentLog(jsonlPath: string, line: Record<string, unknown>): void {
  appendFileSync(jsonlPath, JSON.stringify(line) + "\n");
}

export type SegmentLogLine = {
  segmentId?: string;
  producerId?: string;
  participantId?: string | null;
  startMs?: number;
  endMs?: number;
  tmpPath?: string;
  filePath?: string;
  lastSeenMs?: number;
  status: SegmentStatus;
};

/**
 * Scan for .mp3.part files on startup and recover or discard.
 * Returns list of recovered relative paths.
 */
export function recoverPartFiles(recordingDataDir: string): string[] {
  const recovered: string[] = [];
  const recordingsDir = join(recordingDataDir, "recordings");
  if (!existsSync(recordingsDir)) return recovered;

  const episodeDirs = readdirSync(recordingsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && isSafeDirectoryName(d.name))
    .map((d) => d.name);

  for (const episodeId of episodeDirs) {
    const epDir = join(recordingsDir, episodeId);
    const files = readdirSync(epDir);
    for (const f of files) {
      if (!isSafeFileName(f)) continue; /* defense in depth: skip path traversal filenames */
      if (f.startsWith("_sdp_") && f.endsWith(".sdp")) {
        try {
          unlinkSync(join(epDir, f));
        } catch {
          /* ignore */
        }
        continue;
      }
      if (!f.endsWith(".mp3.part")) continue;
      const fullPath = join(epDir, f);
      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }
      if (stat.size > RECOVERY_SIZE_THRESHOLD) {
        const recoveredName = f.replace(/\.mp3\.part$/, ".recovered.mp3");
        if (!isSafeFileName(recoveredName)) continue; /* recovered name must stay safe */
        const recoveredPath = join(epDir, recoveredName);
        const resolvedPath = resolve(recoveredPath);
        const epDirResolved = resolve(epDir);
        if (resolvedPath !== epDirResolved && !resolvedPath.startsWith(epDirResolved + sep)) continue; /* must stay under epDir */
        try {
          renameSync(fullPath, recoveredPath);
          const rel = join("recordings", episodeId, recoveredName);
          recovered.push(rel);
          const jsonlPath = join(epDir, "segments.jsonl");
          if (existsSync(jsonlPath)) {
            const match = f.match(/^segment_(.+)\.mp3\.part$/);
            const rawSegmentId = match?.[1] ?? "unknown";
            const segmentId = typeof rawSegmentId === "string" && SAFE_ID.test(rawSegmentId) ? rawSegmentId : "unknown";
            appendSegmentLog(jsonlPath, {
              segmentId,
              status: "RECOVERED",
              filePath: rel,
            });
          }
        } catch {
          /* rename failed */
        }
      } else {
        try {
          unlinkSync(fullPath);
        } catch {
          /* ignore */
        }
      }
    }
  }
  return recovered;
}

/** Max age in ms for soundboard temp files before cleanup on startup. 1 hour. */
const SOUNDBOARD_TEMP_MAX_AGE_MS = 60 * 60 * 1000;

/**
 * Remove stale soundboard temp files from previous runs (crash/kill before ffmpeg close).
 * Returns count of files removed.
 */
export function cleanupSoundboardTemp(recordingDataDir: string): number {
  const tempDir = join(recordingDataDir, "soundboard-temp");
  if (!existsSync(tempDir)) return 0;
  let removed = 0;
  const cutoff = Date.now() - SOUNDBOARD_TEMP_MAX_AGE_MS;
  try {
    const files = readdirSync(tempDir);
    for (const f of files) {
      if (!isSafeFileName(f) || !f.startsWith("sb_") || !f.endsWith(".tmp")) continue;
      const fullPath = join(tempDir, f);
      try {
        const stat = statSync(fullPath);
        if (stat.mtimeMs < cutoff) {
          unlinkSync(fullPath);
          removed++;
        }
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
  return removed;
}

/**
 * Read segments.jsonl and find RECORDING entries with no active process (mark INTERRUPTED).
 * Called during recovery - we don't have active processes so any RECORDING is INTERRUPTED.
 */
export function markInterruptedSegments(recordingDataDir: string): void {
  const recordingsDir = join(recordingDataDir, "recordings");
  if (!existsSync(recordingsDir)) return;

  const episodeDirs = readdirSync(recordingsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && isSafeDirectoryName(d.name))
    .map((d) => d.name);

  for (const episodeId of episodeDirs) {
    const jsonlPath = join(recordingsDir, episodeId, "segments.jsonl");
    if (!existsSync(jsonlPath)) continue;

    const content = readFileSync(jsonlPath, "utf8");
    const lines = content.trim().split("\n").filter(Boolean);
    const lastBySegment = new Map<string, SegmentLogLine>();
    for (const line of lines) {
      try {
        const obj = JSON.parse(line) as SegmentLogLine;
        if (obj.segmentId) lastBySegment.set(obj.segmentId, obj);
      } catch {
        /* skip malformed */
      }
    }

    for (const [segId, obj] of lastBySegment) {
      if (obj.status === "RECORDING") {
        appendSegmentLog(jsonlPath, {
          segmentId: segId,
          producerId: obj.producerId,
          status: "INTERRUPTED",
        });
      }
    }
  }
}
