import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  statSync,
} from "fs";
import { dirname } from "path";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import { WORKER_UPLOAD_CHUNK_BYTES } from "./config.js";

const TRANSFER_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour for multi-GB

function fileUrl(
  apiBase: string,
  jobId: string,
  name: string,
  token: string,
): string {
  const base = apiBase.replace(/\/+$/, "");
  return `${base}/workers/jobs/${encodeURIComponent(jobId)}/files/${encodeURIComponent(name)}?token=${encodeURIComponent(token)}`;
}

function chunkUrl(
  apiBase: string,
  jobId: string,
  name: string,
  token: string,
  chunkIndex: number,
  totalChunks: number,
  totalBytes: number,
): string {
  const base = apiBase.replace(/\/+$/, "");
  const q = new URLSearchParams({
    token,
    totalChunks: String(totalChunks),
    totalBytes: String(totalBytes),
  });
  return `${base}/workers/jobs/${encodeURIComponent(jobId)}/files/${encodeURIComponent(name)}/chunks/${chunkIndex}?${q.toString()}`;
}

/** Stream download from HarborFM into a local file (never buffers whole body). */
export async function downloadJobFile(opts: {
  apiBase: string;
  jobId: string;
  name: string;
  token: string;
  destPath: string;
}): Promise<number> {
  mkdirSync(dirname(opts.destPath), { recursive: true });
  const url = fileUrl(opts.apiBase, opts.jobId, opts.name, opts.token);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TRANSFER_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      signal: ac.signal,
      headers: { Authorization: `Bearer ${opts.token}` },
    });
    if (!res.ok) {
      const err = await res.text().catch(() => res.statusText);
      throw new Error(`Download ${opts.name} failed: ${res.status} ${err}`);
    }
    if (!res.body) throw new Error(`Download ${opts.name}: empty body`);
    const out = createWriteStream(opts.destPath);
    const nodeStream = Readable.fromWeb(
      res.body as import("stream/web").ReadableStream,
    );
    await pipeline(nodeStream, out);
    return existsSync(opts.destPath) ? statSync(opts.destPath).size : 0;
  } finally {
    clearTimeout(timer);
  }
}

/** Upload a local file to HarborFM in ~50MiB chunks (avoids nginx 413 on large videos). */
export async function uploadJobFile(opts: {
  apiBase: string;
  jobId: string;
  name: string;
  token: string;
  srcPath: string;
}): Promise<void> {
  if (!existsSync(opts.srcPath)) {
    throw new Error(`Upload missing file: ${opts.srcPath}`);
  }
  const totalBytes = statSync(opts.srcPath).size;
  const totalChunks =
    totalBytes === 0 ? 1 : Math.ceil(totalBytes / WORKER_UPLOAD_CHUNK_BYTES);

  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
    const start = chunkIndex * WORKER_UPLOAD_CHUNK_BYTES;
    const endExclusive =
      totalBytes === 0
        ? 0
        : Math.min(totalBytes, start + WORKER_UPLOAD_CHUNK_BYTES);
    const chunkLength = endExclusive - start;
    const url = chunkUrl(
      opts.apiBase,
      opts.jobId,
      opts.name,
      opts.token,
      chunkIndex,
      totalChunks,
      totalBytes,
    );

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TRANSFER_TIMEOUT_MS);
    try {
      const body =
        chunkLength === 0
          ? Readable.from([])
          : createReadStream(opts.srcPath, {
              start,
              end: endExclusive - 1,
            });
      const res = await fetch(url, {
        method: "PUT",
        signal: ac.signal,
        headers: {
          Authorization: `Bearer ${opts.token}`,
          "Content-Type": "application/octet-stream",
          "Content-Length": String(chunkLength),
        },
        body: body as unknown as BodyInit,
        // @ts-expect-error Node fetch duplex for streaming upload
        duplex: "half",
      });
      if (!res.ok) {
        const err = await res.text().catch(() => res.statusText);
        throw new Error(
          `Upload ${opts.name} chunk ${chunkIndex + 1}/${totalChunks} failed: ${res.status} ${err}`,
        );
      }
      const json = (await res.json().catch(() => null)) as {
        complete?: boolean;
        receivedBytes?: number;
      } | null;
      if (chunkIndex === totalChunks - 1 && json && json.complete === false) {
        throw new Error(
          `Upload ${opts.name}: server did not finalize after last chunk`,
        );
      }
    } finally {
      clearTimeout(timer);
    }
  }
}
