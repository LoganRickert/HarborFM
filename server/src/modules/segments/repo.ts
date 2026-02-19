import { copyFileSync, existsSync, statSync } from "fs";
import { extname } from "path";
import { and, asc, eq, sql } from "drizzle-orm";
import { drizzleDb } from "../../db/index.js";
import {
  episodeSegments,
  episodes,
  reusableAssets,
  users,
} from "../../db/schema.js";
import { sqlNow } from "../../db/utils.js";
import { getPodcastOwnerId } from "../../services/access.js";
import {
  libraryDir,
  pathRelativeToData,
  resolveDataPath,
  segmentPath,
  uploadsDir,
  assertPathUnder,
} from "../../services/paths.js";
import * as audioService from "../../services/audio.js";
import { wouldExceedStorageLimit } from "../../services/storageLimit.js";

export type SegmentListRow = {
  id: string;
  episodeId: string;
  position: number;
  type: "recorded" | "reusable";
  name: string | null;
  reusableAssetId: string | null;
  audioPath: string | null;
  durationSec: number;
  createdAt: string;
  inProgress: boolean;
  recordFailed: boolean;
  trimRanges: string | null;
  markers: string | null;
  assetName: string | null;
};

/** List segments for episode with leftJoin reusableAssets for assetName. */
export function listSegmentsForEpisode(episodeId: string): SegmentListRow[] {
  return drizzleDb
    .select({
      id: episodeSegments.id,
      episodeId: episodeSegments.episodeId,
      position: episodeSegments.position,
      type: episodeSegments.type,
      name: episodeSegments.name,
      reusableAssetId: episodeSegments.reusableAssetId,
      audioPath: episodeSegments.audioPath,
      durationSec: episodeSegments.durationSec,
      createdAt: episodeSegments.createdAt,
      inProgress: episodeSegments.inProgress,
      recordFailed: episodeSegments.recordFailed,
      trimRanges: episodeSegments.trimRanges,
      markers: episodeSegments.markers,
      assetName: reusableAssets.name,
    })
    .from(episodeSegments)
    .leftJoin(
      reusableAssets,
      eq(reusableAssets.id, episodeSegments.reusableAssetId),
    )
    .where(eq(episodeSegments.episodeId, episodeId))
    .orderBy(asc(episodeSegments.position), asc(episodeSegments.createdAt))
    .all() as SegmentListRow[];
}

/** Get one segment by id + episodeId (full row). */
export function getSegmentById(
  segmentId: string,
  episodeId: string,
): Record<string, unknown> | undefined {
  const row = drizzleDb
    .select()
    .from(episodeSegments)
    .where(
      and(
        eq(episodeSegments.id, segmentId),
        eq(episodeSegments.episodeId, episodeId),
      ),
    )
    .limit(1)
    .get();
  return row as Record<string, unknown> | undefined;
}

/** Get segment id and durationSec for PATCH validation. */
export function getSegmentDuration(
  segmentId: string,
  episodeId: string,
): { id: string; durationSec: number } | undefined {
  const row = drizzleDb
    .select({
      id: episodeSegments.id,
      durationSec: episodeSegments.durationSec,
    })
    .from(episodeSegments)
    .where(
      and(
        eq(episodeSegments.id, segmentId),
        eq(episodeSegments.episodeId, episodeId),
      ),
    )
    .limit(1)
    .get();
  return row;
}

/** Max position for episode (next index). */
export function getMaxPosition(episodeId: string): number {
  const row = drizzleDb
    .select({
      pos: sql<number>`COALESCE(MAX(${episodeSegments.position}), -1) + 1`,
    })
    .from(episodeSegments)
    .where(eq(episodeSegments.episodeId, episodeId))
    .get();
  return row?.pos ?? 0;
}

/** Reusable asset: name only. */
export function getReusableAssetName(
  assetId: string,
): { name: string } | undefined {
  return drizzleDb
    .select({ name: reusableAssets.name })
    .from(reusableAssets)
    .where(eq(reusableAssets.id, assetId))
    .limit(1)
    .get();
}

/** Reusable asset: name and copyright (for render copyright snapshot). */
export function getReusableAssetNameAndCopyright(
  assetId: string,
): { name: string; copyright: string | null } | undefined {
  return drizzleDb
    .select({
      name: reusableAssets.name,
      copyright: reusableAssets.copyright,
    })
    .from(reusableAssets)
    .where(eq(reusableAssets.id, assetId))
    .limit(1)
    .get();
}

/** Reusable asset: audioPath and ownerUserId (for path and promote). */
export function getReusableAssetAudio(
  assetId: string,
): { audioPath: string; ownerUserId: string } | undefined {
  return drizzleDb
    .select({
      audioPath: reusableAssets.audioPath,
      ownerUserId: reusableAssets.ownerUserId,
    })
    .from(reusableAssets)
    .where(eq(reusableAssets.id, assetId))
    .limit(1)
    .get();
}

/** Reusable asset: durationSec. */
export function getReusableAssetDuration(
  assetId: string,
): { durationSec: number } | undefined {
  return drizzleDb
    .select({ durationSec: reusableAssets.durationSec })
    .from(reusableAssets)
    .where(eq(reusableAssets.id, assetId))
    .limit(1)
    .get();
}

/** User canTranscribe flag for ASR available. */
export function getUserCanTranscribe(userId: string): boolean {
  const row = drizzleDb
    .select({
      canTranscribe: sql<number>`COALESCE(${users.canTranscribe}, 0)`,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
    .get();
  return row?.canTranscribe === 1;
}

/** Insert reusable segment. */
export function insertSegmentReusable(values: {
  id: string;
  episodeId: string;
  position: number;
  name: string;
  reusableAssetId: string;
  durationSec: number;
}): void {
  drizzleDb.insert(episodeSegments).values({
    id: values.id,
    episodeId: values.episodeId,
    position: values.position,
    type: "reusable",
    name: values.name,
    reusableAssetId: values.reusableAssetId,
    durationSec: values.durationSec,
  }).run();
}

/** Insert recorded segment. */
export function insertSegmentRecorded(values: {
  id: string;
  episodeId: string;
  position: number;
  name: string;
  audioPath: string;
  durationSec: number;
}): void {
  drizzleDb.insert(episodeSegments).values({
    id: values.id,
    episodeId: values.episodeId,
    position: values.position,
    type: "recorded",
    name: values.name,
    audioPath: values.audioPath,
    durationSec: values.durationSec,
  }).run();
}

/** Add disk bytes to podcast owner (after recorded upload or promote). */
export function addUserDiskBytes(userId: string, bytes: number): void {
  drizzleDb
    .update(users)
    .set({
      diskBytesUsed: sql`COALESCE(${users.diskBytesUsed}, 0) + ${bytes}`,
    })
    .where(eq(users.id, userId))
    .run();
}

/** Reorder: set position for each segment id. */
export function reorderSegments(
  episodeId: string,
  segmentIds: string[],
): void {
  for (let i = 0; i < segmentIds.length; i++) {
    drizzleDb
      .update(episodeSegments)
      .set({ position: i })
      .where(
        and(
          eq(episodeSegments.id, segmentIds[i]),
          eq(episodeSegments.episodeId, episodeId),
        ),
      )
      .run();
  }
}

const updateWhere = (
  segmentId: string,
  episodeId: string,
) => and(
  eq(episodeSegments.id, segmentId),
  eq(episodeSegments.episodeId, episodeId),
);

export function updateSegmentName(
  segmentId: string,
  episodeId: string,
  name: string | null,
): void {
  drizzleDb
    .update(episodeSegments)
    .set({ name })
    .where(updateWhere(segmentId, episodeId))
    .run();
}

export function updateSegmentTrimRanges(
  segmentId: string,
  episodeId: string,
  trimRanges: string,
): void {
  drizzleDb
    .update(episodeSegments)
    .set({ trimRanges })
    .where(updateWhere(segmentId, episodeId))
    .run();
}

export function updateSegmentMarkers(
  segmentId: string,
  episodeId: string,
  markers: string,
): void {
  drizzleDb
    .update(episodeSegments)
    .set({ markers })
    .where(updateWhere(segmentId, episodeId))
    .run();
}

/** Get segment audio path and base dir (for stream, waveform, trim, etc.). */
export function getSegmentAudioPath(
  segment: Record<string, unknown>,
  podcastId: string,
  episodeId: string,
): { path: string; base: string } | null {
  const audioPath = segment.audioPath;
  const reusableId = segment.reusableAssetId;
  if (segment.type === "recorded" && audioPath) {
    return {
      path: resolveDataPath(audioPath as string),
      base: uploadsDir(podcastId, episodeId),
    };
  }
  if (segment.type === "reusable" && reusableId) {
    const asset = getReusableAssetAudio(reusableId as string);
    if (asset?.audioPath) {
      return {
        path: resolveDataPath(asset.audioPath),
        base: libraryDir(asset.ownerUserId),
      };
    }
  }
  return null;
}

/**
 * Promote reusable segment to recorded: copy library file to episode segment path,
 * probe, generate waveform, update user disk, update segment row.
 */
export async function promoteReusableSegmentToRecorded(
  segment: Record<string, unknown>,
  episodeId: string,
  podcastId: string,
): Promise<Record<string, unknown>> {
  if (segment.type !== "reusable" || !segment.reusableAssetId) {
    throw new Error("Segment is not a reusable (library) segment");
  }
  const reusableId = segment.reusableAssetId as string;
  const asset = getReusableAssetAudio(reusableId);
  if (!asset?.audioPath) throw new Error("Library asset audio not found");
  const assetPath = resolveDataPath(asset.audioPath);
  if (!existsSync(assetPath)) throw new Error("Library asset audio not found");
  assertPathUnder(assetPath, libraryDir(asset.ownerUserId));

  const storageUserId = getPodcastOwnerId(podcastId);
  if (!storageUserId) {
    throw new Error("Podcast owner not found");
  }
  const bytesToAdd = statSync(assetPath).size;
  if (wouldExceedStorageLimit(drizzleDb, storageUserId, bytesToAdd)) {
    throw new Error("Storage limit exceeded");
  }

  const ext = (extname(assetPath).replace(/^\./, "") || "mp3").toLowerCase();
  const destPath = segmentPath(podcastId, episodeId, segment.id as string, ext);
  copyFileSync(assetPath, destPath);

  let durationSec = 0;
  try {
    const probe = await audioService.probeAudio(
      destPath,
      uploadsDir(podcastId, episodeId),
    );
    durationSec = Math.max(0, probe.durationSec);
  } catch {
    /* keep 0 if probe fails */
  }

  try {
    await audioService.generateWaveformFile(
      destPath,
      uploadsDir(podcastId, episodeId),
    );
  } catch {
    /* best-effort */
  }

  addUserDiskBytes(storageUserId, bytesToAdd);

  drizzleDb
    .update(episodeSegments)
    .set({
      type: "recorded",
      audioPath: pathRelativeToData(destPath),
      reusableAssetId: null,
      durationSec,
    })
    .where(updateWhere(segment.id as string, episodeId))
    .run();

  const row = getSegmentById(segment.id as string, episodeId);
  return row as Record<string, unknown>;
}

/** Update segment after trim / remove-silence (audioPath, durationSec). */
export function updateSegmentAudio(
  segmentId: string,
  episodeId: string,
  audioPath: string,
  durationSec: number,
  extra?: { trimRanges?: string; markers?: string },
): void {
  const set: Record<string, unknown> = {
    audioPath: pathRelativeToData(audioPath),
    durationSec,
  };
  if (extra?.trimRanges !== undefined) set.trimRanges = extra.trimRanges;
  if (extra?.markers !== undefined) set.markers = extra.markers;
  drizzleDb
    .update(episodeSegments)
    .set(set as { audioPath: string; durationSec: number; trimRanges?: string; markers?: string })
    .where(updateWhere(segmentId, episodeId))
    .run();
}

/** Update segment to recorded with new path (after trim that promoted reusable). */
export function updateSegmentToRecorded(
  segmentId: string,
  episodeId: string,
  audioPath: string,
  durationSec: number,
): void {
  drizzleDb
    .update(episodeSegments)
    .set({
      audioPath: pathRelativeToData(audioPath),
      reusableAssetId: null,
      type: "recorded",
      durationSec,
    })
    .where(updateWhere(segmentId, episodeId))
    .run();
}

/** Delete segment by id + episodeId. */
export function deleteSegment(segmentId: string, episodeId: string): void {
  drizzleDb
    .delete(episodeSegments)
    .where(updateWhere(segmentId, episodeId))
    .run();
}

/** Subtract disk bytes from user (after segment delete). */
export function subtractUserDiskBytes(userId: string, bytes: number): void {
  drizzleDb
    .update(users)
    .set({
      diskBytesUsed: sql`CASE
        WHEN COALESCE(${users.diskBytesUsed}, 0) - ${bytes} < 0 THEN 0
        ELSE COALESCE(${users.diskBytesUsed}, 0) - ${bytes}
      END`,
    })
    .where(eq(users.id, userId))
    .run();
}

/** List all segments for episode (for render). */
export function listSegmentsForRender(
  episodeId: string,
): Array<Record<string, unknown>> {
  const rows = drizzleDb
    .select()
    .from(episodeSegments)
    .where(eq(episodeSegments.episodeId, episodeId))
    .orderBy(asc(episodeSegments.position), asc(episodeSegments.createdAt))
    .all();
  return rows as Array<Record<string, unknown>>;
}

/** Episode row for render: update after build. */
export function updateEpisodeAfterRender(
  episodeId: string,
  data: {
    audioFinalPath: string;
    audioSourcePath: string;
    audioMime: string;
    audioBytes: number;
    audioDurationSec: number;
    descriptionCopyrightSnapshot: string | null;
    finalMarkers: string;
  },
): void {
  drizzleDb
    .update(episodes)
    .set({
      audioFinalPath: pathRelativeToData(data.audioFinalPath),
      audioSourcePath: pathRelativeToData(data.audioSourcePath),
      audioMime: data.audioMime,
      audioBytes: data.audioBytes,
      audioDurationSec: data.audioDurationSec,
      descriptionCopyrightSnapshot: data.descriptionCopyrightSnapshot,
      finalMarkers: data.finalMarkers,
      updatedAt: sqlNow(),
    })
    .where(eq(episodes.id, episodeId))
    .run();
}

/** Episode status and publishAt (for RSS/WebSub after render). */
export function getEpisodeStatusPublishAt(
  episodeId: string,
): { status: string; publishAt: string | null } | undefined {
  return drizzleDb
    .select({
      status: episodes.status,
      publishAt: episodes.publishAt,
    })
    .from(episodes)
    .where(eq(episodes.id, episodeId))
    .limit(1)
    .get();
}

/** Episode id, podcastId, audioFinalPath (for transcript routes). */
export function getEpisodeForTranscript(
  episodeId: string,
): { id: string; podcastId: string; audioFinalPath: string | null } | undefined {
  return drizzleDb
    .select({
      id: episodes.id,
      podcastId: episodes.podcastId,
      audioFinalPath: episodes.audioFinalPath,
    })
    .from(episodes)
    .where(eq(episodes.id, episodeId))
    .limit(1)
    .get();
}
