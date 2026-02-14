import { join, resolve, sep } from "path";
import { mkdirSync, existsSync, realpathSync } from "fs";

const DATA_DIR = resolve(process.env.DATA_DIR ?? join(process.cwd(), "data"));
const SECRETS_DIR = resolve(
  process.env.SECRETS_DIR ?? join(process.cwd(), "secrets"),
);

/** Only allow IDs that cannot be used for path traversal (nanoid-style: alphanumeric, hyphen, underscore). */
const SAFE_ID = /^[a-zA-Z0-9_-]+$/;

export function assertSafeId(id: string, name: string): void {
  if (!SAFE_ID.test(id)) {
    throw new Error(`Invalid ${name}: disallowed characters`);
  }
}

/**
 * Generate a timestamped filename in format: YYYYMMDD_HHMMSS_nanoid.ext
 * Example: 20250513_010517_920b941ac63405e3d0bd01125388afb3.mp3
 */
function generateTimestampedFilename(id: string, ext: string): string {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");
  const timestamp = `${year}${month}${day}_${hours}${minutes}${seconds}`;
  return `${timestamp}_${id}.${ext}`;
}

/**
 * Resolve path to real path and assert it is under allowedBase. Throws if path escapes or doesn't exist.
 * Use this when the path already exists (e.g. before read/delete). For paths that don't exist yet (e.g. before write), use assertResolvedPathUnder.
 */
export function assertPathUnder(
  pathToCheck: string,
  allowedBase: string,
): string {
  const base = resolve(realpathSync(allowedBase));
  const resolved = resolve(realpathSync(pathToCheck));
  if (resolved !== base && !resolved.startsWith(base + sep)) {
    throw new Error("Path escapes allowed directory");
  }
  return resolved;
}

/**
 * Asserts that pathToCheck, when resolved, is under allowedBase. Does not require pathToCheck to exist.
 * Use this before creating/writing a file. For existing paths use assertPathUnder (which uses realpathSync).
 */
export function assertResolvedPathUnder(
  pathToCheck: string,
  allowedBase: string,
): void {
  const base = resolve(allowedBase);
  const resolved = resolve(pathToCheck);
  if (resolved !== base && !resolved.startsWith(base + sep)) {
    throw new Error("Path escapes allowed directory");
  }
}

export function getDataDir() {
  return DATA_DIR;
}

export function getSecretsDir() {
  return SECRETS_DIR;
}

export function ensureSecretsDir() {
  if (!existsSync(SECRETS_DIR)) {
    mkdirSync(SECRETS_DIR, { recursive: true });
  }
}

export function ensureDir(dir: string) {
  assertResolvedPathUnder(dir, DATA_DIR);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export function uploadsDir(podcastId: string, episodeId: string): string {
  assertSafeId(podcastId, "podcastId");
  assertSafeId(episodeId, "episodeId");
  const dir = join(DATA_DIR, "uploads", podcastId, episodeId);
  ensureDir(dir);
  return dir;
}

export function processedDir(podcastId: string, episodeId: string): string {
  assertSafeId(podcastId, "podcastId");
  assertSafeId(episodeId, "episodeId");
  const dir = join(DATA_DIR, "processed", podcastId, episodeId);
  ensureDir(dir);
  return dir;
}

/** Path to episode-level transcript SRT file (when Whisper is used after render). Does not create dir. */
export function transcriptSrtPath(
  podcastId: string,
  episodeId: string,
): string {
  assertSafeId(podcastId, "podcastId");
  assertSafeId(episodeId, "episodeId");
  return join(DATA_DIR, "processed", podcastId, episodeId, "transcript.srt");
}

export function rssDir(podcastId: string): string {
  assertSafeId(podcastId, "podcastId");
  const dir = join(DATA_DIR, "rss", podcastId);
  ensureDir(dir);
  return dir;
}

/** Directory for sitemap index (data/sitemap). Per-podcast sitemaps live in data/sitemap/:podcastId. */
export function sitemapIndexDir(): string {
  const dir = join(DATA_DIR, "sitemap");
  ensureDir(dir);
  return dir;
}

export function sitemapDir(podcastId: string): string {
  assertSafeId(podcastId, "podcastId");
  const dir = join(DATA_DIR, "sitemap", podcastId);
  ensureDir(dir);
  return dir;
}

export function artworkDir(podcastId: string): string {
  assertSafeId(podcastId, "podcastId");
  const dir = join(DATA_DIR, "artwork", podcastId);
  ensureDir(dir);
  return dir;
}

/** Directory for cast member photos (within podcast artwork dir). */
export function castPhotoDir(podcastId: string): string {
  assertSafeId(podcastId, "podcastId");
  const dir = join(artworkDir(podcastId), "cast");
  ensureDir(dir);
  return dir;
}

export function episodeArtworkPath(
  podcastId: string,
  episodeId: string,
  ext = "jpg",
): string {
  assertSafeId(episodeId, "episodeId");
  const dir = artworkDir(podcastId);
  if (!/^[a-zA-Z0-9]+$/.test(ext)) throw new Error("Invalid artwork extension");
  return join(dir, `${episodeId}.${ext}`);
}

/** Reusable library assets (ads, intros, etc.) per user. */
export function libraryDir(userId: string): string {
  assertSafeId(userId, "userId");
  const dir = join(DATA_DIR, "library", userId);
  ensureDir(dir);
  return dir;
}

export function libraryAssetPath(
  userId: string,
  assetId: string,
  ext = "mp3",
): string {
  assertSafeId(assetId, "assetId");
  if (!/^[a-zA-Z0-9]+$/.test(ext)) throw new Error("Invalid extension");
  const filename = generateTimestampedFilename(assetId, ext);
  return join(libraryDir(userId), filename);
}

/** Recorded segment stored under episode uploads. */
export function segmentPath(
  podcastId: string,
  episodeId: string,
  segmentId: string,
  ext = "mp3",
): string {
  assertSafeId(segmentId, "segmentId");
  if (!/^[a-zA-Z0-9]+$/.test(ext)) throw new Error("Invalid extension");
  const dir = join(DATA_DIR, "uploads", podcastId, episodeId, "segments");
  ensureDir(dir);
  const filename = generateTimestampedFilename(segmentId, ext);
  return join(dir, filename);
}
