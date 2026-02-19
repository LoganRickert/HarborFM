import { createWriteStream, writeFileSync } from "fs";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import { Transform } from "stream";
import { assertUrlNotPrivate } from "../../utils/ssrf.js";
import { FileTooLargeError } from "../../services/uploads.js";
import {
  IMPORT_USER_AGENT,
  IMPORT_FETCH_TIMEOUT_MS,
  ARTWORK_MAX_BYTES,
} from "../../config.js";

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
 */
export async function downloadToFile(
  url: string,
  destPath: string,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<number> {
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
 * Download image from URL to destPath. Validates image type and size. Uses import User-Agent and timeout.
 */
export async function downloadArtworkToPath(
  url: string,
  destPath: string,
  signal?: AbortSignal,
): Promise<void> {
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
    const contentType = res.headers.get("Content-Type");
    const buf = await res.arrayBuffer();
    if (buf.byteLength > ARTWORK_MAX_BYTES)
      throw new Error(`Artwork too large (max ${ARTWORK_MAX_BYTES} bytes)`);
    const type = (contentType ?? "").toLowerCase();
    if (!type.startsWith("image/")) throw new Error("Not an image");
    writeFileSync(destPath, new Uint8Array(buf));
  } finally {
    clearTimeout(timeoutId);
  }
}
