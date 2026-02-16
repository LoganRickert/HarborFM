import { appendFileSync, existsSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync } from "fs";
import { join } from "path";
import type { SegmentStatus } from "./recordingTypes.js";

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
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  for (const episodeId of episodeDirs) {
    const epDir = join(recordingsDir, episodeId);
    const files = readdirSync(epDir);
    for (const f of files) {
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
        const recoveredPath = join(epDir, recoveredName);
        try {
          renameSync(fullPath, recoveredPath);
          const rel = join("recordings", episodeId, recoveredName);
          recovered.push(rel);
          const jsonlPath = join(epDir, "segments.jsonl");
          if (existsSync(jsonlPath)) {
            const match = f.match(/^segment_(.+)\.mp3\.part$/);
            const segmentId = match?.[1] ?? "unknown";
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

/**
 * Read segments.jsonl and find RECORDING entries with no active process (mark INTERRUPTED).
 * Called during recovery - we don't have active processes so any RECORDING is INTERRUPTED.
 */
export function markInterruptedSegments(recordingDataDir: string): void {
  const recordingsDir = join(recordingDataDir, "recordings");
  if (!existsSync(recordingsDir)) return;

  const episodeDirs = readdirSync(recordingsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
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
