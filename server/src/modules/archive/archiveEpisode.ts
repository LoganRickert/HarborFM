import { createHash } from "crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "fs";
import { basename, join } from "path";
import { tmpdir } from "os";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getPodcastOwnerId } from "../../services/access.js";
import {
  assertResolvedPathUnder,
  getDataDir,
} from "../../services/paths.js";
import {
  archiveRemoteRelativePath,
  backupRemoteDirPrefix,
  backupRemoteRelativePath,
  downloadOne,
  listDir,
  uploadOne,
  verifyUploadedArchive,
  ArchiveColdStorageError,
} from "../../services/remoteFile.js";
import { sha256File } from "../../utils/hash.js";
import { drizzleDb } from "../../db/index.js";
import {
  episodeFiles,
  episodeSegments,
} from "../../db/schema.js";
import * as episodeRepo from "../episodes/repo.js";
import { getOrBuildProjectZip } from "../episodes/projectExport.js";
import { restoreArchivedProjectZip } from "../episodes/projectRestore.js";
import { subtractUserDiskBytes } from "../segments/repo.js";
import { sumFileBytesForEpisode } from "../episodeFiles/repo.js";
import * as archiveRepo from "./repo.js";
import { getDecryptedArchiveConfig } from "./utils.js";

export { ArchiveColdStorageError };

function dirBytesRecursive(dir: string): number {
  if (!existsSync(dir)) return 0;
  let total = 0;
  const walk = (p: string) => {
    let st;
    try {
      st = statSync(p);
    } catch {
      return;
    }
    if (st.isDirectory()) {
      for (const name of readdirSync(p)) walk(join(p, name));
    } else {
      total += st.size;
    }
  };
  walk(dir);
  return total;
}

/** Append `_YYYYMMDD_HHMMSS` before `.zip`. */
export function datedBackupFilename(
  baseFilename: string,
  at: Date = new Date(),
): string {
  const y = String(at.getFullYear());
  const m = String(at.getMonth() + 1).padStart(2, "0");
  const d = String(at.getDate()).padStart(2, "0");
  const hh = String(at.getHours()).padStart(2, "0");
  const mm = String(at.getMinutes()).padStart(2, "0");
  const ss = String(at.getSeconds()).padStart(2, "0");
  const stamp = `${y}${m}${d}_${hh}${mm}${ss}`;
  if (/\.zip$/i.test(baseFilename)) {
    return baseFilename.replace(/\.zip$/i, `_${stamp}.zip`);
  }
  return `${baseFilename}_${stamp}.zip`;
}

function isSafeBackupFilename(name: string): boolean {
  if (!name || name !== basename(name)) return false;
  if (
    name.includes("..") ||
    name.includes("/") ||
    name.includes("\\") ||
    name.includes("\0")
  ) {
    return false;
  }
  if (!/\.zip$/i.test(name) || name.length > 512) return false;
  return true;
}

type UploadedProjectZip = {
  remotePath: string;
  archiveSha256: string;
  archiveBytes: number;
  archiveFilename: string;
};

/**
 * Zip the episode project and upload to the show archive destination.
 * `kind: "backup"` uses a separate remote folder and does not mark the episode archived.
 */
async function zipAndUploadProject(
  episodeId: string,
  kind: "archive" | "backup",
  opts?: { dated?: boolean },
): Promise<UploadedProjectZip> {
  const episode = episodeRepo.getById(episodeId);
  if (!episode) throw new Error("Episode not found");
  if (kind === "archive" && episode.archivedAt) {
    throw new Error("Episode is already archived");
  }
  if (kind === "backup" && episode.archivedAt) {
    throw new Error("Restore the project before backing up");
  }
  if (!episode.audioFinalPath) {
    throw new Error(
      kind === "backup"
        ? "Build the final episode before backing up"
        : "Build the final episode before archiving",
    );
  }

  const podcastId = episode.podcastId;
  const settings = archiveRepo.getByPodcastId(podcastId);
  if (!settings) {
    throw new Error(
      "Archive Settings are not configured for this show. Open Archive Settings on the show page first.",
    );
  }

  const { zipPath, filename: baseFilename } = await getOrBuildProjectZip(
    episodeId,
    podcastId,
  );
  const filename =
    kind === "backup" && opts?.dated
      ? datedBackupFilename(baseFilename)
      : baseFilename;
  const archiveBytes = statSync(zipPath).size;
  const archiveSha256 = (await sha256File(zipPath)) ?? "";
  if (!archiveSha256) throw new Error("Failed to hash archive zip");

  const body = readFileSync(zipPath);
  const localMd5 = createHash("md5").update(body).digest("hex");

  const remotePath =
    kind === "backup"
      ? backupRemoteRelativePath(podcastId, episodeId, filename)
      : archiveRemoteRelativePath(podcastId, episodeId, filename);
  const decrypted = getDecryptedArchiveConfig(settings);

  await uploadOne(decrypted, remotePath, body, "application/zip");
  await verifyUploadedArchive(decrypted, remotePath, archiveBytes, localMd5);

  return {
    remotePath,
    archiveSha256,
    archiveBytes,
    archiveFilename: filename,
  };
}

/** Clear local project files (uploads + segment/file rows). Keeps processed/. */
async function clearLocalProjectFiles(episodeId: string): Promise<void> {
  const episode = episodeRepo.getById(episodeId);
  if (!episode) throw new Error("Episode not found");
  const podcastId = episode.podcastId;

  let bytesFreed = 0;
  try {
    bytesFreed += sumFileBytesForEpisode(episodeId);
  } catch {
    /* best-effort */
  }

  const uploadsEpisodeDir = join(getDataDir(), "uploads", podcastId, episodeId);
  assertResolvedPathUnder(uploadsEpisodeDir, getDataDir());
  if (existsSync(uploadsEpisodeDir)) {
    try {
      bytesFreed = Math.max(bytesFreed, dirBytesRecursive(uploadsEpisodeDir));
      rmSync(uploadsEpisodeDir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }

  drizzleDb
    .delete(episodeSegments)
    .where(eq(episodeSegments.episodeId, episodeId))
    .run();
  drizzleDb
    .delete(episodeFiles)
    .where(eq(episodeFiles.episodeId, episodeId))
    .run();

  const ownerId = getPodcastOwnerId(podcastId);
  if (ownerId && bytesFreed > 0) {
    subtractUserDiskBytes(ownerId, bytesFreed);
  }
}

/**
 * Zip episode project, upload to archive destination, verify, then delete local
 * project files (uploads + segments). Keeps processed/ and artwork for the feed.
 */
export async function archiveEpisode(episodeId: string): Promise<{
  archivedAt: string;
  archiveRemotePath: string;
  archiveSha256: string;
  archiveBytes: number;
  archiveFilename: string;
}> {
  const uploaded = await zipAndUploadProject(episodeId, "archive");
  await clearLocalProjectFiles(episodeId);

  const archivedAt = new Date().toISOString();
  archiveRepo.setEpisodeArchived(episodeId, {
    archivedAt,
    archiveRemotePath: uploaded.remotePath,
    archiveSha256: uploaded.archiveSha256,
    archiveBytes: uploaded.archiveBytes,
    archiveFilename: uploaded.archiveFilename,
  });

  return {
    archivedAt,
    archiveRemotePath: uploaded.remotePath,
    archiveSha256: uploaded.archiveSha256,
    archiveBytes: uploaded.archiveBytes,
    archiveFilename: uploaded.archiveFilename,
  };
}

/**
 * Zip and upload to the archive destination without deleting local project files
 * or marking the episode archived.
 */
export async function backupEpisode(
  episodeId: string,
  opts?: { dated?: boolean },
): Promise<{
  backupRemotePath: string;
  backupSha256: string;
  backupBytes: number;
  backupFilename: string;
}> {
  const uploaded = await zipAndUploadProject(episodeId, "backup", {
    dated: Boolean(opts?.dated),
  });
  return {
    backupRemotePath: uploaded.remotePath,
    backupSha256: uploaded.archiveSha256,
    backupBytes: uploaded.archiveBytes,
    backupFilename: uploaded.archiveFilename,
  };
}

export type EpisodeBackupListItem = {
  filename: string;
  remotePath: string;
  size: number;
  lastModified: string | null;
};

/** List backup zips for this episode on the archive destination. */
export async function listEpisodeBackups(
  episodeId: string,
): Promise<EpisodeBackupListItem[]> {
  const episode = episodeRepo.getById(episodeId);
  if (!episode) throw new Error("Episode not found");
  const settings = archiveRepo.getByPodcastId(episode.podcastId);
  if (!settings) {
    throw new Error(
      "Archive Settings are not configured for this show. Open Archive Settings on the show page first.",
    );
  }
  const decrypted = getDecryptedArchiveConfig(settings);
  const dir = backupRemoteDirPrefix(episode.podcastId, episodeId);
  const files = await listDir(decrypted, dir);
  return files
    .filter((f) => /\.zip$/i.test(f.filename))
    .map((f) => ({
      filename: f.filename,
      remotePath: f.remotePath,
      size: f.size,
      lastModified: f.lastModified,
    }))
    .sort((a, b) => {
      const ta = a.lastModified || a.filename;
      const tb = b.lastModified || b.filename;
      return tb.localeCompare(ta);
    });
}

/**
 * Download a backup zip and restore project files into the live episode
 * (does not mark archived / does not clear archived flags).
 */
export async function restoreEpisodeBackup(
  episodeId: string,
  filename: string,
  importerUserId: string,
): Promise<{ warning?: string }> {
  const episode = episodeRepo.getById(episodeId);
  if (!episode) throw new Error("Episode not found");
  if (episode.archivedAt) {
    throw new Error("Restore the archived project before restoring a backup");
  }
  if (!isSafeBackupFilename(filename)) {
    throw new Error("Invalid backup filename");
  }

  const settings = archiveRepo.getByPodcastId(episode.podcastId);
  if (!settings) {
    throw new Error("Archive Settings are not configured for this show");
  }

  const remotePath = backupRemoteRelativePath(
    episode.podcastId,
    episodeId,
    filename,
  );
  const decrypted = getDecryptedArchiveConfig(settings);

  // Ensure the file exists on the destination before wiping local project files.
  const listed = await listDir(
    decrypted,
    backupRemoteDirPrefix(episode.podcastId, episodeId),
  );
  if (!listed.some((f) => f.filename === filename)) {
    throw new Error("Backup not found on the archive destination");
  }

  const tmpDir = mkdtempSync(
    join(tmpdir(), `harborfm-backup-restore-${nanoid()}-`),
  );
  const zipPath = join(tmpDir, filename);

  try {
    await downloadOne(decrypted, remotePath, zipPath);
    await clearLocalProjectFiles(episodeId);
    const result = await restoreArchivedProjectZip(
      episodeId,
      zipPath,
      importerUserId,
    );
    return { warning: result.warning };
  } finally {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

/**
 * Download archive zip and restore project files without overwriting episode metadata.
 */
export async function restoreEpisode(
  episodeId: string,
  importerUserId: string,
): Promise<{ warning?: string }> {
  const episode = episodeRepo.getById(episodeId);
  if (!episode) throw new Error("Episode not found");
  if (!episode.archivedAt || !episode.archiveRemotePath) {
    throw new Error("Episode is not archived");
  }

  const settings = archiveRepo.getByPodcastId(episode.podcastId);
  if (!settings) {
    throw new Error("Archive Settings are not configured for this show");
  }

  const decrypted = getDecryptedArchiveConfig(settings);
  const tmpDir = mkdtempSync(
    join(tmpdir(), `harborfm-archive-restore-${nanoid()}-`),
  );
  const zipPath = join(tmpDir, episode.archiveFilename || "project.zip");

  try {
    await downloadOne(decrypted, episode.archiveRemotePath, zipPath);
    const result = await restoreArchivedProjectZip(
      episodeId,
      zipPath,
      importerUserId,
    );
    archiveRepo.clearEpisodeArchived(episodeId);
    return { warning: result.warning };
  } finally {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}
