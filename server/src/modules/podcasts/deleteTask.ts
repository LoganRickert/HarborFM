import { existsSync, rmSync, statSync, unlinkSync } from "fs";
import { join } from "path";
import { eq, sql } from "drizzle-orm";
import { drizzleDb } from "../../db/index.js";
import { episodeSegments, episodes, podcasts, users } from "../../db/schema.js";
import { deleteTokenFeedTemplateFile } from "../../services/rss.js";
import { notifyWebSubHub } from "../../services/websub.js";
import {
  assertPathUnder,
  assertResolvedPathUnder,
  assertSafeId,
  artworkDir,
  getDataDir,
  resolveDataPath,
} from "../../services/paths.js";

export interface DeleteStatusState {
  status: "pending" | "deleting" | "done" | "failed";
  message?: string;
  error?: string;
  current?: number;
  total?: number;
  /** User who initiated the delete (for clearing activeDeleteByUserId when done). */
  initiatorUserId?: string;
}

const deleteStatusByPodcastId = new Map<string, DeleteStatusState>();
/** userId -> podcastId: one delete per user at a time (like import). */
const activeDeleteByUserId = new Map<string, string>();

export function getDeleteStatus(podcastId: string): DeleteStatusState | undefined {
  return deleteStatusByPodcastId.get(podcastId);
}

export function setDeleteStatus(
  podcastId: string,
  state: DeleteStatusState,
): void {
  deleteStatusByPodcastId.set(podcastId, state);
}

export function clearDeleteStatus(
  podcastId: string,
  initiatorUserId?: string,
): void {
  const state = deleteStatusByPodcastId.get(podcastId);
  deleteStatusByPodcastId.delete(podcastId);
  const userId = initiatorUserId ?? state?.initiatorUserId;
  if (userId) activeDeleteByUserId.delete(userId);
}

export function hasActiveDeleteForUser(userId: string): boolean {
  return activeDeleteByUserId.has(userId);
}

export function getActiveDeletePodcastId(userId: string): string | undefined {
  return activeDeleteByUserId.get(userId);
}

export function setActiveDelete(userId: string, podcastId: string): void {
  activeDeleteByUserId.set(userId, podcastId);
}

/**
 * Delete a single episode's files and DB row. Does NOT touch RSS/WebSub.
 * Returns bytes freed for storage accounting.
 */
function deleteEpisodeData(
  episodeId: string,
  podcastId: string,
  storageUserId: string,
): number {
  assertSafeId(podcastId, "podcastId");
  assertSafeId(episodeId, "episodeId");
  const segmentBase = join(getDataDir(), "uploads", podcastId, episodeId);

  const episodeRow = drizzleDb
    .select({
      artworkPath: episodes.artworkPath,
      audioSourcePath: episodes.audioSourcePath,
    })
    .from(episodes)
    .where(eq(episodes.id, episodeId))
    .limit(1)
    .get();
  if (!episodeRow) return 0;

  let bytesFreed = 0;

  const segments = drizzleDb
    .select({ audioPath: episodeSegments.audioPath })
    .from(episodeSegments)
    .where(eq(episodeSegments.episodeId, episodeId))
    .all();
  for (const seg of segments) {
    const path = seg.audioPath ? resolveDataPath(seg.audioPath) : "";
    if (!path) continue;
    try {
      assertPathUnder(path, segmentBase);
      bytesFreed += statSync(path).size;
    } catch {
      /* best-effort */
    }
  }
  const audioSourcePath = episodeRow.audioSourcePath
    ? resolveDataPath(episodeRow.audioSourcePath)
    : "";
  if (audioSourcePath && existsSync(audioSourcePath)) {
    try {
      assertPathUnder(audioSourcePath, segmentBase);
      bytesFreed += statSync(audioSourcePath).size;
    } catch {
      /* best-effort */
    }
  }

  const procDir = join(getDataDir(), "processed", podcastId, episodeId);
  assertResolvedPathUnder(procDir, getDataDir());
  if (existsSync(procDir)) {
    try {
      rmSync(procDir, { recursive: true });
    } catch {
      /* best-effort */
    }
  }
  const uploadsEpisodeDir = join(
    getDataDir(),
    "uploads",
    podcastId,
    episodeId,
  );
  assertResolvedPathUnder(uploadsEpisodeDir, getDataDir());
  if (existsSync(uploadsEpisodeDir)) {
    try {
      rmSync(uploadsEpisodeDir, { recursive: true });
    } catch {
      /* best-effort */
    }
  }
  const episodeArtPath = episodeRow.artworkPath
    ? resolveDataPath(episodeRow.artworkPath)
    : "";
  if (episodeArtPath && existsSync(episodeArtPath)) {
    try {
      const artDir = artworkDir(podcastId);
      assertPathUnder(episodeArtPath, artDir);
      unlinkSync(episodeArtPath);
    } catch {
      /* best-effort */
    }
  }

  if (bytesFreed > 0) {
    drizzleDb
      .update(users)
      .set({
        diskBytesUsed: sql`CASE WHEN COALESCE(disk_bytes_used, 0) - ${bytesFreed} < 0 THEN 0 ELSE COALESCE(disk_bytes_used, 0) - ${bytesFreed} END`,
      })
      .where(eq(users.id, storageUserId))
      .run();
  }

  drizzleDb.delete(episodes).where(eq(episodes.id, episodeId)).run();
  return bytesFreed;
}

/**
 * Delete a podcast and all its data (episodes, audio, artwork, rss, etc.) synchronously.
 * Does NOT use the async status machinery. Use for admin operations like user deletion.
 */
export function runPodcastDeleteSync(podcastId: string): void {
  const ownerRow = drizzleDb
    .select({ ownerUserId: podcasts.ownerUserId })
    .from(podcasts)
    .where(eq(podcasts.id, podcastId))
    .limit(1)
    .get();
  if (!ownerRow) return;

  const storageUserId = ownerRow.ownerUserId;
  const episodeRows = drizzleDb
    .select({ id: episodes.id })
    .from(episodes)
    .where(eq(episodes.podcastId, podcastId))
    .orderBy(episodes.id)
    .all();

  for (const ep of episodeRows) {
    deleteEpisodeData(ep.id, podcastId, storageUserId);
  }

  try {
    notifyWebSubHub(podcastId, null);
  } catch (_) {
    /* non-fatal */
  }
  deleteTokenFeedTemplateFile(podcastId);

  const dataDir = getDataDir();
  const dirs = [
    join(dataDir, "artwork", podcastId),
    join(dataDir, "rss", podcastId),
    join(dataDir, "sitemap", podcastId),
  ];
  for (const dir of dirs) {
    try {
      assertResolvedPathUnder(dir, dataDir);
      if (existsSync(dir)) {
        rmSync(dir, { recursive: true });
      }
    } catch (_) {
      /* best-effort */
    }
  }

  drizzleDb.delete(podcasts).where(eq(podcasts.id, podcastId)).run();
}

/**
 * Run the full podcast deletion. Updates deleteStatusByPodcastId as it progresses.
 * Call from setImmediate to avoid blocking the request.
 */
export async function runPodcastDelete(
  podcastId: string,
  initiatorUserId: string,
): Promise<void> {
  const state = deleteStatusByPodcastId.get(podcastId);
  if (!state || state.status !== "pending") return;

  try {
    const ownerRow = drizzleDb
      .select({ ownerUserId: podcasts.ownerUserId })
      .from(podcasts)
      .where(eq(podcasts.id, podcastId))
      .limit(1)
      .get();
    if (!ownerRow) {
      setDeleteStatus(podcastId, {
        status: "failed",
        error: "Podcast not found",
      });
      return;
    }
    const storageUserId = ownerRow.ownerUserId;

    const episodeRows = drizzleDb
      .select({ id: episodes.id })
      .from(episodes)
      .where(eq(episodes.podcastId, podcastId))
      .orderBy(episodes.id)
      .all();
    const total = episodeRows.length;

    setDeleteStatus(podcastId, {
      status: "deleting",
      message: `Deleting episodes (0 / ${total})`,
      current: 0,
      total,
    });

    for (let i = 0; i < episodeRows.length; i++) {
      deleteEpisodeData(episodeRows[i].id, podcastId, storageUserId);
      setDeleteStatus(podcastId, {
        status: "deleting",
        message: `Deleting episodes (${i + 1} / ${total})`,
        current: i + 1,
        total,
      });
    }

    setDeleteStatus(podcastId, {
      status: "deleting",
      message: "Removing podcast files…",
      current: total,
      total,
    });

    try {
      notifyWebSubHub(podcastId, null);
    } catch (_) {
      /* non-fatal */
    }
    deleteTokenFeedTemplateFile(podcastId);

    const dataDir = getDataDir();
    const dirs = [
      join(dataDir, "artwork", podcastId),
      join(dataDir, "rss", podcastId),
      join(dataDir, "sitemap", podcastId),
    ];
    for (const dir of dirs) {
      try {
        assertResolvedPathUnder(dir, dataDir);
        if (existsSync(dir)) {
          rmSync(dir, { recursive: true });
        }
      } catch (_) {
        /* best-effort */
      }
    }

    drizzleDb.delete(podcasts).where(eq(podcasts.id, podcastId)).run();
    activeDeleteByUserId.delete(initiatorUserId);

    setDeleteStatus(podcastId, {
      status: "done",
      message: "Podcast deleted",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setDeleteStatus(podcastId, {
      status: "failed",
      error: message,
      initiatorUserId,
    });
    activeDeleteByUserId.delete(initiatorUserId);
  }
}
