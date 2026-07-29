import {
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  unlinkSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { nanoid } from "nanoid";
import type { Readable } from "stream";

const UPLOAD_TTL_MS = 60 * 60 * 1000;
const STAGING_DIR = join(tmpdir(), "harborfm-chunked-uploads");

export class ChunkTooLargeError extends Error {
  constructor(message = "Upload failed: one piece of the file was too large. Refresh the page and try again.") {
    super(message);
    this.name = "ChunkTooLargeError";
  }
}

export class ChunkedUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChunkedUploadError";
  }
}

type ChunkedUploadState = {
  uploadId: string;
  userId: string;
  purpose: string;
  filename: string;
  nextIndex: number;
  totalChunks: number;
  totalBytes: number;
  receivedBytes: number;
  tmpPath: string;
  createdAt: number;
};

const uploads = new Map<string, ChunkedUploadState>();

function ensureStagingDir(): void {
  if (!existsSync(STAGING_DIR)) mkdirSync(STAGING_DIR, { recursive: true });
}

function unlinkQuiet(path: string): void {
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {
    /* ignore */
  }
}

function purgeExpired(): void {
  const now = Date.now();
  for (const [id, state] of uploads) {
    if (now - state.createdAt > UPLOAD_TTL_MS) {
      unlinkQuiet(state.tmpPath);
      unlinkQuiet(finalPathFor(state));
      uploads.delete(id);
    }
  }
}

function finalPathFor(state: ChunkedUploadState): string {
  return state.tmpPath.replace(/\.partial$/, ".zip");
}

function pipeBodyToWriteStream(
  body: NodeJS.ReadableStream,
  out: ReturnType<typeof createWriteStream>,
  maxBytes: number,
): Promise<number> {
  let bytes = 0;
  return new Promise<void>((resolve, reject) => {
    const readable = body as NodeJS.ReadableStream & {
      destroy?: (err?: Error) => void;
    };
    readable.on("data", (chunk: Buffer | string) => {
      const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      bytes += buf.length;
      if (bytes > maxBytes) {
        readable.destroy?.(new ChunkTooLargeError());
        out.destroy();
        reject(new ChunkTooLargeError());
        return;
      }
    });
    readable.on("error", reject);
    out.on("error", reject);
    out.on("finish", () => resolve());
    readable.pipe(out);
  }).then(() => bytes);
}

/**
 * Start a chunked upload session. Caller must own auth; purpose is opaque metadata.
 */
export function createChunkedUpload(opts: {
  userId: string;
  purpose: string;
  totalBytes: number;
  totalChunks: number;
  filename?: string;
}): { uploadId: string } {
  purgeExpired();
  const { userId, purpose, totalBytes, totalChunks } = opts;
  if (
    !Number.isInteger(totalChunks) ||
    totalChunks < 1 ||
    !Number.isFinite(totalBytes) ||
    totalBytes < 0
  ) {
    throw new ChunkedUploadError("Invalid upload metadata");
  }
  ensureStagingDir();
  const uploadId = nanoid();
  const tmpPath = join(STAGING_DIR, `${uploadId}.partial`);
  uploads.set(uploadId, {
    uploadId,
    userId,
    purpose,
    filename: opts.filename?.trim() || "project.zip",
    nextIndex: 0,
    totalChunks,
    totalBytes,
    receivedBytes: 0,
    tmpPath,
    createdAt: Date.now(),
  });
  return { uploadId };
}

export function getChunkedUpload(
  uploadId: string,
  userId: string,
): ChunkedUploadState | null {
  purgeExpired();
  const state = uploads.get(uploadId);
  if (!state || state.userId !== userId) return null;
  return state;
}

/**
 * Append one sequential chunk. Chunks must arrive in order (0..totalChunks-1).
 * When complete is true, the assembled zip path is ready (still owned by the session
 * until finalizeChunkedUpload or abortChunkedUpload).
 */
export async function appendChunkedUpload(
  uploadId: string,
  userId: string,
  opts: {
    chunkIndex: number;
    totalChunks: number;
    totalBytes: number;
    body: Readable;
    chunkLength?: number;
    maxChunkBytes: number;
  },
): Promise<{ bytes: number; receivedBytes: number; complete: boolean }> {
  const state = getChunkedUpload(uploadId, userId);
  if (!state) {
    throw new ChunkedUploadError("Upload not found or expired");
  }

  const { chunkIndex, totalChunks, totalBytes, body, chunkLength, maxChunkBytes } =
    opts;
  if (
    !Number.isInteger(chunkIndex) ||
    chunkIndex < 0 ||
    chunkIndex >= totalChunks ||
    totalChunks !== state.totalChunks ||
    totalBytes !== state.totalBytes
  ) {
    throw new ChunkedUploadError("Invalid chunk upload metadata");
  }

  if (chunkIndex === 0) {
    unlinkQuiet(state.tmpPath);
    unlinkQuiet(finalPathFor(state));
    state.nextIndex = 0;
    state.receivedBytes = 0;
  } else if (state.nextIndex === 0 && chunkIndex !== 0) {
    throw new ChunkedUploadError(
      "Chunk upload has not started (expected chunk 0 first)",
    );
  }

  if (state.nextIndex !== chunkIndex) {
    throw new ChunkedUploadError(
      `Out-of-order chunk: expected ${state.nextIndex}, got ${chunkIndex}`,
    );
  }

  const out = createWriteStream(state.tmpPath, {
    flags: chunkIndex === 0 ? "w" : "a",
  });
  let bytes: number;
  try {
    bytes = await pipeBodyToWriteStream(body, out, maxChunkBytes);
  } catch (err) {
    unlinkQuiet(state.tmpPath);
    uploads.delete(uploadId);
    throw err;
  }

  if (chunkLength != null && chunkLength > 0 && bytes !== chunkLength) {
    unlinkQuiet(state.tmpPath);
    uploads.delete(uploadId);
    throw new ChunkedUploadError(
      `Chunk size mismatch for #${chunkIndex}: expected ${chunkLength}, got ${bytes}`,
    );
  }

  state.receivedBytes += bytes;
  state.nextIndex = chunkIndex + 1;

  const complete = chunkIndex === totalChunks - 1;
  if (complete) {
    if (state.receivedBytes !== totalBytes) {
      unlinkQuiet(state.tmpPath);
      uploads.delete(uploadId);
      throw new ChunkedUploadError(
        `Upload size mismatch: expected ${totalBytes}, got ${state.receivedBytes}`,
      );
    }
    const dest = finalPathFor(state);
    renameSync(state.tmpPath, dest);
    state.tmpPath = dest;
  }

  return {
    bytes,
    receivedBytes: state.receivedBytes,
    complete,
  };
}

/**
 * Claim the assembled zip path and remove the session. Caller owns cleanup of the path.
 */
export function finalizeChunkedUpload(
  uploadId: string,
  userId: string,
): string {
  const state = getChunkedUpload(uploadId, userId);
  if (!state) {
    throw new ChunkedUploadError("Upload not found or expired");
  }
  if (state.nextIndex !== state.totalChunks) {
    throw new ChunkedUploadError("Upload is incomplete");
  }
  const path = state.tmpPath;
  if (!existsSync(path) || !path.endsWith(".zip")) {
    uploads.delete(uploadId);
    throw new ChunkedUploadError("Upload file missing");
  }
  uploads.delete(uploadId);
  return path;
}

export function abortChunkedUpload(uploadId: string, userId: string): void {
  const state = getChunkedUpload(uploadId, userId);
  if (!state) return;
  unlinkQuiet(state.tmpPath);
  unlinkQuiet(finalPathFor(state));
  uploads.delete(uploadId);
}
