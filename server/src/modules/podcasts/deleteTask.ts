import { existsSync, rmSync, statSync, unlinkSync } from "fs";
import { join } from "path";
import { db } from "../../db/index.js";
import { deleteTokenFeedTemplateFile } from "../../services/rss.js";
import { notifyWebSubHub } from "../../services/websub.js";
import {
  assertPathUnder,
  assertResolvedPathUnder,
  assertSafeId,
  artworkDir,
  getDataDir,
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

  const episodeRow = db
    .prepare(
      "SELECT artwork_path, audio_source_path FROM episodes WHERE id = ?",
    )
    .get(episodeId) as
    | { artwork_path: string | null; audio_source_path: string | null }
    | undefined;
  if (!episodeRow) return 0;

  let bytesFreed = 0;

  const segments = db
    .prepare(
      "SELECT audio_path FROM episode_segments WHERE episode_id = ? AND audio_path IS NOT NULL",
    )
    .all(episodeId) as { audio_path: string }[];
  for (const seg of segments) {
    const path = seg.audio_path;
    if (!path) continue;
    try {
      assertPathUnder(path, segmentBase);
      bytesFreed += statSync(path).size;
    } catch {
      /* best-effort */
    }
  }
  if (episodeRow.audio_source_path && existsSync(episodeRow.audio_source_path)) {
    try {
      assertPathUnder(episodeRow.audio_source_path, segmentBase);
      bytesFreed += statSync(episodeRow.audio_source_path).size;
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
  if (episodeRow.artwork_path && existsSync(episodeRow.artwork_path)) {
    try {
      const artDir = artworkDir(podcastId);
      assertPathUnder(episodeRow.artwork_path, artDir);
      unlinkSync(episodeRow.artwork_path);
    } catch {
      /* best-effort */
    }
  }

  if (bytesFreed > 0) {
    db.prepare(
      `UPDATE users
       SET disk_bytes_used =
         CASE
           WHEN COALESCE(disk_bytes_used, 0) - ? < 0 THEN 0
           ELSE COALESCE(disk_bytes_used, 0) - ?
         END
       WHERE id = ?`,
    ).run(bytesFreed, bytesFreed, storageUserId);
  }

  db.prepare("DELETE FROM episodes WHERE id = ?").run(episodeId);
  return bytesFreed;
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
    const ownerRow = db
      .prepare("SELECT owner_user_id FROM podcasts WHERE id = ?")
      .get(podcastId) as { owner_user_id: string } | undefined;
    if (!ownerRow) {
      setDeleteStatus(podcastId, {
        status: "failed",
        error: "Podcast not found",
      });
      return;
    }
    const storageUserId = ownerRow.owner_user_id;

    const episodes = db
      .prepare(
        "SELECT id FROM episodes WHERE podcast_id = ? ORDER BY id ASC",
      )
      .all(podcastId) as { id: string }[];
    const total = episodes.length;

    setDeleteStatus(podcastId, {
      status: "deleting",
      message: `Deleting episodes (0 / ${total})`,
      current: 0,
      total,
    });

    for (let i = 0; i < episodes.length; i++) {
      deleteEpisodeData(episodes[i].id, podcastId, storageUserId);
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

    db.prepare("DELETE FROM podcasts WHERE id = ?").run(podcastId);
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
