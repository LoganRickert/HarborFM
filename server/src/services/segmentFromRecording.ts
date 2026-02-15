import { statSync } from "fs";
import { db } from "../db/index.js";
import { getPodcastOwnerId } from "./access.js";
import { uploadsDir, assertPathUnder } from "./paths.js";
import * as audioService from "./audio.js";
import { wouldExceedStorageLimit } from "./storageLimit.js";

/**
 * Create a segment row from an existing recording file (e.g. written by the webrtc recording service).
 * Path must be under uploadsDir(podcastId, episodeId). Updates disk usage for the podcast owner.
 */
export async function createSegmentFromPath(
  filePath: string,
  segmentId: string,
  episodeId: string,
  podcastId: string,
  segmentName: string | null,
): Promise<Record<string, unknown>> {
  const existing = db.prepare("SELECT * FROM episode_segments WHERE id = ?").get(segmentId);
  if (existing) {
    return existing as Record<string, unknown>;
  }

  const episode = db.prepare("SELECT podcast_id FROM episodes WHERE id = ?").get(episodeId) as
    | { podcast_id: string }
    | undefined;
  if (!episode || episode.podcast_id !== podcastId) {
    throw new Error("Episode does not belong to podcast");
  }

  const segmentBase = uploadsDir(podcastId, episodeId);
  const resolvedPath = assertPathUnder(filePath, segmentBase);

  const stat = statSync(resolvedPath);
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

  const maxPos = db
    .prepare(
      "SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM episode_segments WHERE episode_id = ?",
    )
    .get(episodeId) as { pos: number };

  try {
    db.prepare(
      `INSERT INTO episode_segments (id, episode_id, position, type, name, audio_path, duration_sec)
       VALUES (?, ?, ?, 'recorded', ?, ?, ?)`,
    ).run(
      segmentId,
      episodeId,
      maxPos.pos,
      segmentName,
      resolvedPath,
      durationSec,
    );

    db.prepare(
      `UPDATE users
       SET disk_bytes_used = COALESCE(disk_bytes_used, 0) + ?
       WHERE id = ?`,
    ).run(bytesWritten, storageUserId);
  } catch (err: unknown) {
    const sqliteErr = err as { code?: string };
    if (sqliteErr?.code === "SQLITE_CONSTRAINT_PRIMARYKEY" || sqliteErr?.code === "SQLITE_CONSTRAINT") {
      const existing = db.prepare("SELECT * FROM episode_segments WHERE id = ?").get(segmentId);
      if (existing) return existing as Record<string, unknown>;
    }
    throw err;
  }

  const row = db
    .prepare("SELECT * FROM episode_segments WHERE id = ?")
    .get(segmentId) as Record<string, unknown>;
  return row;
}
