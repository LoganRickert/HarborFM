import { createWriteStream, writeFileSync, renameSync, unlinkSync, existsSync } from "fs";
import { join } from "path";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import { Transform } from "stream";
import { nanoid } from "nanoid";
import { assertUrlNotPrivate } from "../../utils/ssrf.js";
import { FileTooLargeError } from "../../services/uploads.js";
import {
  IMPORT_USER_AGENT,
  IMPORT_FETCH_TIMEOUT_MS,
  ARTWORK_MAX_BYTES,
} from "../../config.js";
import {
  imageExtFromMagic,
  MIMETYPE_TO_EXT,
} from "../../utils/artwork.js";
import {
  assertResolvedPathUnder,
  artworkDir,
  pathRelativeToData,
} from "../../services/paths.js";

export interface ImportStatusState {
  status: "pending" | "importing" | "done" | "failed";
  message?: string;
  error?: string;
  current?: number;
  total?: number;
}

export const importStatusByPodcastId = new Map<string, ImportStatusState>();
/** userId -> podcastId: so we can block multiple imports and restore popup on refresh. */
export const activeImportByUserId = new Map<string, string>();

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Download URL to file with size limit. Throws FileTooLargeError if exceeded.
 * @param timeoutMs - Abort after this many ms (default IMPORT_FETCH_TIMEOUT_MS).
 */
export async function downloadToFile(
  url: string,
  destPath: string,
  maxBytes: number,
  signal?: AbortSignal,
  timeoutMs: number = IMPORT_FETCH_TIMEOUT_MS,
): Promise<number> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  if (signal) {
    signal.addEventListener("abort", () => controller.abort());
  }
  try {
    await assertUrlNotPrivate(url);
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": IMPORT_USER_AGENT },
    });
    clearTimeout(timeoutId);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    const body = res.body;
    if (!body) throw new Error("No response body");

    const nodeStream = Readable.fromWeb(
      body as Parameters<typeof Readable.fromWeb>[0],
    );
    let bytes = 0;
    const limit = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        bytes += chunk.length;
        if (bytes > maxBytes) {
          cb(new FileTooLargeError());
          return;
        }
        cb(null, chunk);
      },
    });
    const out = createWriteStream(destPath, { flags: "w" });
    await pipeline(nodeStream, limit, out);
    return bytes;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function extFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const lower = pathname.toLowerCase();
    if (lower.endsWith(".png")) return "png";
    if (lower.endsWith(".webp")) return "webp";
    if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "jpg";
  } catch {
    // ignore
  }
  return "jpg";
}

/**
 * Download image from URL to destPath. Validates image type and size.
 * Accepts Content-Type image/* or sniffs magic bytes when type is missing/wrong.
 * Returns the extension used (png|webp|jpg).
 */
export async function downloadArtworkToPath(
  url: string,
  destPath: string,
  signal?: AbortSignal,
): Promise<"png" | "webp" | "jpg"> {
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    IMPORT_FETCH_TIMEOUT_MS,
  );
  if (signal) {
    signal.addEventListener("abort", () => controller.abort());
  }
  try {
    await assertUrlNotPrivate(url);
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": IMPORT_USER_AGENT },
    });
    clearTimeout(timeoutId);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    const contentType = (res.headers.get("Content-Type") ?? "")
      .toLowerCase()
      .split(";")[0]
      .trim();
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > ARTWORK_MAX_BYTES)
      throw new Error(`Artwork too large (max ${ARTWORK_MAX_BYTES} bytes)`);

    const fromMime = MIMETYPE_TO_EXT[contentType] as
      | "png"
      | "webp"
      | "jpg"
      | undefined;
    const fromMagic = imageExtFromMagic(buf);
    if (!fromMime && !fromMagic) {
      throw new Error("Not an image");
    }
    const ext = fromMagic ?? fromMime ?? "jpg";
    writeFileSync(destPath, buf);
    return ext;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Download cover art into the podcast artwork directory (same as the image uploader).
 * Returns the data-relative path, or null if download/validation fails.
 */
export async function downloadArtworkForPodcast(
  podcastId: string,
  url: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const dir = artworkDir(podcastId);
  const tmpPath = join(dir, `.${nanoid()}.import-art`);
  try {
    const ext = await downloadArtworkToPath(url, tmpPath, signal);
    const finalPath = join(dir, `${nanoid()}.${ext}`);
    assertResolvedPathUnder(finalPath, dir);
    renameSync(tmpPath, finalPath);
    return pathRelativeToData(finalPath);
  } catch {
    if (existsSync(tmpPath)) {
      try {
        unlinkSync(tmpPath);
      } catch {
        /* ignore */
      }
    }
    return null;
  }
}
