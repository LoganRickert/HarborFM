import { statSync, copyFileSync, existsSync } from "fs";
import { resolve, join } from "path";
import { db } from "../db/index.js";
import { getPodcastOwnerId } from "./access.js";
import { uploadsDir, assertResolvedPathUnder, getWebrtcRecordingsDir, segmentPath } from "./paths.js";
import * as audioService from "./audio.js";
import { wouldExceedStorageLimit } from "./storageLimit.js";

/**
 * Create a placeholder segment row when host clicks "Record Segment". Marked in_progress=1.
 * Called before webrtc start-recording; actual audio is filled in by createSegmentFromPath on success.
 */
export function createRecordingSegmentPlaceholder(
  segmentId: string,
  episodeId: string,
  podcastId: string,
  segmentName: string | null,
): Record<string, unknown> {
  const episode = db.prepare("SELECT podcast_id FROM episodes WHERE id = ?").get(episodeId) as
    | { podcast_id: string }
    | undefined;
  if (!episode || episode.podcast_id !== podcastId) {
    throw new Error("Episode does not belong to podcast");
  }

  const maxPos = db
    .prepare(
      "SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM episode_segments WHERE episode_id = ?",
    )
    .get(episodeId) as { pos: number };

  db.prepare(
    `INSERT INTO episode_segments (id, episode_id, position, type, name, audio_path, duration_sec, in_progress, record_failed)
     VALUES (?, ?, ?, 'recorded', ?, NULL, 0, 1, 0)`,
  ).run(segmentId, episodeId, maxPos.pos, segmentName);

  const row = db
    .prepare("SELECT * FROM episode_segments WHERE id = ?")
    .get(segmentId) as Record<string, unknown>;
  return row;
}

/**
 * Mark a placeholder segment as having failed to record (ffmpeg failed, webrtc error, etc).
 */
export function markSegmentRecordFailed(segmentId: string): void {
  db.prepare(
    "UPDATE episode_segments SET in_progress = 0, record_failed = 1, name = COALESCE(NULLIF(TRIM(name), ''), 'Recording Failed') WHERE id = ? AND in_progress = 1",
  ).run(segmentId);
}

/**
 * Try to recover a record_failed segment from the webrtc recordings directory.
 * The webrtc service may have written the file before the callback failed.
 * Returns the updated segment row on success; throws on failure.
 */
export async function recoverRecordedSegment(segmentId: string): Promise<Record<string, unknown>> {
  const row = db.prepare("SELECT * FROM episode_segments WHERE id = ?").get(segmentId) as
    | { episode_id: string; record_failed?: number }
    | undefined;
  if (!row || row.record_failed !== 1) {
    throw new Error("Segment is not in failed state or does not exist");
  }
  const episodeId = row.episode_id;
  const episode = db.prepare("SELECT podcast_id FROM episodes WHERE id = ?").get(episodeId) as
    | { podcast_id: string }
    | undefined;
  if (!episode) {
    throw new Error("Episode not found");
  }
  const podcastId = episode.podcast_id;
  const webrtcDir = getWebrtcRecordingsDir();
  const sourcePath = resolve(join(webrtcDir, "recordings", `${segmentId}.wav`));
  if (!existsSync(sourcePath)) {
    throw new Error("Recording file not found. The file may have been deleted or never saved.");
  }
  const stat = statSync(sourcePath);
  if (stat.size === 0) {
    throw new Error("Recording file is empty. No audio was captured.");
  }
  const destPath = segmentPath(podcastId, episodeId, segmentId, "wav");
  const segmentBase = uploadsDir(podcastId, episodeId);
  copyFileSync(sourcePath, destPath);
  if (!existsSync(destPath)) {
    throw new Error("Failed to copy recording file");
  }
  const storageUserId = getPodcastOwnerId(podcastId);
  if (!storageUserId) {
    throw new Error("Podcast owner not found");
  }
  if (wouldExceedStorageLimit(db, storageUserId, stat.size)) {
    throw new Error("Storage limit exceeded");
  }
  let durationSec = 0;
  try {
    const probe = await audioService.probeAudio(destPath, segmentBase);
    durationSec = Math.max(0, probe.durationSec);
  } catch {
    // keep 0 if probe fails
  }
  try {
    await audioService.generateWaveformFile(destPath, segmentBase);
  } catch {
    // best-effort
  }
  db.prepare(
    `UPDATE episode_segments SET audio_path = ?, duration_sec = ?, record_failed = 0 WHERE id = ? AND record_failed = 1`,
  ).run(destPath, durationSec, segmentId);
  db.prepare(
    `UPDATE users SET disk_bytes_used = COALESCE(disk_bytes_used, 0) + ? WHERE id = ?`,
  ).run(stat.size, storageUserId);
  const updated = db.prepare("SELECT * FROM episode_segments WHERE id = ?").get(segmentId) as Record<string, unknown>;
  try {
    const { unlinkSync } = await import("fs");
    unlinkSync(sourcePath);
  } catch {
    // ignore - source may be in use or permissions
  }
  return updated;
}

/**
 * Create a segment row from an existing recording file (e.g. written by the webrtc recording service).
 * Path must be under uploadsDir(podcastId, episodeId). Updates disk usage for the podcast owner.
 * If a placeholder segment (in_progress=1) exists, updates it instead of inserting.
 */
export async function createSegmentFromPath(
  filePath: string,
  segmentId: string,
  episodeId: string,
  podcastId: string,
  segmentName: string | null,
): Promise<Record<string, unknown>> {
  const existing = db.prepare("SELECT * FROM episode_segments WHERE id = ?").get(segmentId) as
    | { in_progress?: number }
    | undefined;
  if (existing) {
    if (existing.in_progress === 0) {
      return existing as Record<string, unknown>; /* idempotency for duplicate callback */
    }
    /* in_progress=1: placeholder from createRecordingSegmentPlaceholder; we will UPDATE */
  }

  const episode = db.prepare("SELECT podcast_id FROM episodes WHERE id = ?").get(episodeId) as
    | { podcast_id: string }
    | undefined;
  if (!episode || episode.podcast_id !== podcastId) {
    throw new Error("Episode does not belong to podcast");
  }

  const segmentBase = uploadsDir(podcastId, episodeId);
  assertResolvedPathUnder(filePath, segmentBase);
  const resolvedPath = resolve(filePath);
  let stat;
  try {
    stat = statSync(resolvedPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      throw new Error("Recording file was not found. The recording may have been stopped before it could be saved.");
    }
    throw err;
  }
  const bytesWritten = stat.size;

  if (bytesWritten === 0) {
    throw new Error(
      "Recording produced no audio. Ensure your microphone is unmuted and that you're connected to the call before recording.",
    );
  }

  const storageUserId = getPodcastOwnerId(podcastId);
  if (!storageUserId) {
    throw new Error("Podcast owner not found");
  }
  if (wouldExceedStorageLimit(db, storageUserId, bytesWritten)) {
    throw new Error("Storage limit exceeded");
  }

  let durationSec = 0;
  try {
    const probe = await audioService.probeAudio(resolvedPath, segmentBase);
    durationSec = Math.max(0, probe.durationSec);
  } catch {
    // keep 0 if probe fails
  }

  try {
    await audioService.generateWaveformFile(resolvedPath, segmentBase);
  } catch {
    // best-effort
  }

  const isPlaceholderUpdate = existing && existing.in_progress === 1;

  try {
    if (isPlaceholderUpdate) {
      db.prepare(
        `UPDATE episode_segments
         SET audio_path = ?, duration_sec = ?, name = COALESCE(?, name), in_progress = 0, record_failed = 0
         WHERE id = ? AND in_progress = 1`,
      ).run(resolvedPath, durationSec, segmentName, segmentId);
    } else {
      const maxPos = db
        .prepare(
          "SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM episode_segments WHERE episode_id = ?",
        )
        .get(episodeId) as { pos: number };

      db.prepare(
        `INSERT INTO episode_segments (id, episode_id, position, type, name, audio_path, duration_sec)
         VALUES (?, ?, ?, 'recorded', ?, ?, ?)`,
      ).run(segmentId, episodeId, maxPos.pos, segmentName, resolvedPath, durationSec);
    }

    db.prepare(
      `UPDATE users
       SET disk_bytes_used = COALESCE(disk_bytes_used, 0) + ?
       WHERE id = ?`,
    ).run(bytesWritten, storageUserId);
  } catch (err: unknown) {
    const sqliteErr = err as { code?: string };
    if (sqliteErr?.code === "SQLITE_CONSTRAINT_PRIMARYKEY" || sqliteErr?.code === "SQLITE_CONSTRAINT") {
      const existingRow = db.prepare("SELECT * FROM episode_segments WHERE id = ?").get(segmentId);
      if (existingRow) return existingRow as Record<string, unknown>;
    }
    throw err;
  }

  const row = db
    .prepare("SELECT * FROM episode_segments WHERE id = ?")
    .get(segmentId) as Record<string, unknown>;
  return row;
}
