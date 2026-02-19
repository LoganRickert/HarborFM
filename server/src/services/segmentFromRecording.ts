import { statSync, copyFileSync, existsSync } from "fs";
import { resolve, join } from "path";
import { and, eq, sql } from "drizzle-orm";
import { drizzleDb } from "../db/index.js";
import { episodeSegments, episodes, users } from "../db/schema.js";
import { getPodcastOwnerId } from "./access.js";
import {
  uploadsDir,
  assertResolvedPathUnder,
  getWebrtcRecordingsDir,
  segmentPath,
  pathRelativeToData,
} from "./paths.js";
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
  const episode = drizzleDb
    .select({ podcastId: episodes.podcastId })
    .from(episodes)
    .where(eq(episodes.id, episodeId))
    .limit(1)
    .get();
  if (!episode || episode.podcastId !== podcastId) {
    throw new Error("Episode does not belong to podcast");
  }

  const maxPosRow = drizzleDb
    .select({
      pos: sql<number>`COALESCE(MAX(${episodeSegments.position}), -1) + 1`,
    })
    .from(episodeSegments)
    .where(eq(episodeSegments.episodeId, episodeId))
    .get();
  const pos = maxPosRow?.pos ?? 0;

  drizzleDb
    .insert(episodeSegments)
    .values({
      id: segmentId,
      episodeId,
      position: pos,
      type: "recorded",
      name: segmentName,
      audioPath: null,
      durationSec: 0,
      inProgress: true,
      recordFailed: false,
    })
    .run();

  const row = drizzleDb
    .select()
    .from(episodeSegments)
    .where(eq(episodeSegments.id, segmentId))
    .limit(1)
    .get();
  return row as Record<string, unknown>;
}

/**
 * Mark a placeholder segment as having failed to record (ffmpeg failed, webrtc error, etc).
 */
export function markSegmentRecordFailed(segmentId: string): void {
  drizzleDb
    .update(episodeSegments)
    .set({
      inProgress: false,
      recordFailed: true,
      name: sql`COALESCE(NULLIF(TRIM(${episodeSegments.name}), ''), 'Recording Failed')`,
    })
    .where(and(eq(episodeSegments.id, segmentId), eq(episodeSegments.inProgress, true)))
    .run();
}

/**
 * Try to recover a record_failed segment from the webrtc recordings directory.
 * The webrtc service may have written the file before the callback failed.
 * Returns the updated segment row on success; throws on failure.
 */
export async function recoverRecordedSegment(segmentId: string): Promise<Record<string, unknown>> {
  const row = drizzleDb
    .select({ episodeId: episodeSegments.episodeId, recordFailed: episodeSegments.recordFailed })
    .from(episodeSegments)
    .where(eq(episodeSegments.id, segmentId))
    .limit(1)
    .get();
  if (!row || !row.recordFailed) {
    throw new Error("Segment is not in failed state or does not exist");
  }
  const episodeId = row.episodeId;
  const episode = drizzleDb
    .select({ podcastId: episodes.podcastId })
    .from(episodes)
    .where(eq(episodes.id, episodeId))
    .limit(1)
    .get();
  if (!episode) {
    throw new Error("Episode not found");
  }
  const podcastId = episode.podcastId;
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
  if (wouldExceedStorageLimit(drizzleDb, storageUserId, stat.size)) {
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
  const relPath = pathRelativeToData(destPath);
  drizzleDb
    .update(episodeSegments)
    .set({ audioPath: relPath, durationSec, recordFailed: false })
    .where(and(eq(episodeSegments.id, segmentId), eq(episodeSegments.recordFailed, true)))
    .run();
  drizzleDb
    .update(users)
    .set({
      diskBytesUsed: sql`COALESCE(${users.diskBytesUsed}, 0) + ${stat.size}`,
    })
    .where(eq(users.id, storageUserId))
    .run();
  const updated = drizzleDb
    .select()
    .from(episodeSegments)
    .where(eq(episodeSegments.id, segmentId))
    .limit(1)
    .get();
  try {
    const { unlinkSync } = await import("fs");
    unlinkSync(sourcePath);
  } catch {
    // ignore - source may be in use or permissions
  }
  return updated as Record<string, unknown>;
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
  const existing = drizzleDb
    .select()
    .from(episodeSegments)
    .where(eq(episodeSegments.id, segmentId))
    .limit(1)
    .get();
  if (existing) {
    if (!existing.inProgress) {
      return existing as Record<string, unknown>; /* idempotency for duplicate callback */
    }
    /* inProgress=true: placeholder from createRecordingSegmentPlaceholder; we will UPDATE */
  }

  const episode = drizzleDb
    .select({ podcastId: episodes.podcastId })
    .from(episodes)
    .where(eq(episodes.id, episodeId))
    .limit(1)
    .get();
  if (!episode || episode.podcastId !== podcastId) {
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
  if (wouldExceedStorageLimit(drizzleDb, storageUserId, bytesWritten)) {
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

  const isPlaceholderUpdate = existing?.inProgress === true;
  const relPath = pathRelativeToData(resolvedPath);

  try {
    if (isPlaceholderUpdate) {
      const set: {
        audioPath: string;
        durationSec: number;
        inProgress: boolean;
        recordFailed: boolean;
        name?: string;
      } = {
        audioPath: relPath,
        durationSec,
        inProgress: false,
        recordFailed: false,
      };
      if (segmentName != null) set.name = segmentName;
      drizzleDb
        .update(episodeSegments)
        .set(set)
        .where(and(eq(episodeSegments.id, segmentId), eq(episodeSegments.inProgress, true)))
        .run();
    } else {
      const maxPosRow = drizzleDb
        .select({
          pos: sql<number>`COALESCE(MAX(${episodeSegments.position}), -1) + 1`,
        })
        .from(episodeSegments)
        .where(eq(episodeSegments.episodeId, episodeId))
        .get();
      const pos = maxPosRow?.pos ?? 0;
      drizzleDb
        .insert(episodeSegments)
        .values({
          id: segmentId,
          episodeId,
          position: pos,
          type: "recorded",
          name: segmentName,
          audioPath: relPath,
          durationSec,
        })
        .run();
    }

    drizzleDb
      .update(users)
      .set({
        diskBytesUsed: sql`COALESCE(${users.diskBytesUsed}, 0) + ${bytesWritten}`,
      })
      .where(eq(users.id, storageUserId))
      .run();
  } catch (err: unknown) {
    const sqliteErr = err as { code?: string };
    if (sqliteErr?.code === "SQLITE_CONSTRAINT_PRIMARYKEY" || sqliteErr?.code === "SQLITE_CONSTRAINT") {
      const existingRow = drizzleDb
        .select()
        .from(episodeSegments)
        .where(eq(episodeSegments.id, segmentId))
        .limit(1)
        .get();
      if (existingRow) return existingRow as Record<string, unknown>;
    }
    throw err;
  }

  const row = drizzleDb
    .select()
    .from(episodeSegments)
    .where(eq(episodeSegments.id, segmentId))
    .limit(1)
    .get();
  return row as Record<string, unknown>;
}
