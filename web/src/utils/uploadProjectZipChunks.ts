import { csrfHeaders } from '../api/client';
import { normalizeProjectImportError } from './normalizeProjectImportError';

/** Must stay in sync with server PROJECT_IMPORT_CHUNK_MB default (50). */
const CHUNK_BYTES = 50 * 1024 * 1024;

export type ProjectZipUploadPhase = 'validating' | 'uploading' | 'importing';

export type ProjectZipUploadHooks = {
  onPhase?: (phase: ProjectZipUploadPhase) => void;
};

type StartUploadResponse = {
  uploadId: string;
  chunkBytes?: number;
};

async function readErrorMessage(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  try {
    const json = JSON.parse(text) as { error?: string; message?: string };
    return json.error || json.message || text || res.statusText;
  } catch {
    return text || res.statusText || 'Request failed';
  }
}

function throwNormalized(message: string, status: number): never {
  throw new Error(normalizeProjectImportError(message, status));
}

/**
 * Upload a project/segment zip in ~50 MiB chunks, then POST finish.
 * `uploadBasePath` is e.g. `/api/podcasts/.../import-project/upload`
 * (no trailing slash).
 */
export async function uploadProjectZipChunks(
  uploadBasePath: string,
  file: File,
  hooks?: ProjectZipUploadHooks,
): Promise<void> {
  hooks?.onPhase?.('uploading');

  const totalBytes = file.size;
  const totalChunks =
    totalBytes === 0 ? 1 : Math.ceil(totalBytes / CHUNK_BYTES);

  let startRes: Response;
  try {
    startRes = await fetch(uploadBasePath, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...csrfHeaders(),
      },
      body: JSON.stringify({
        totalBytes,
        totalChunks,
        filename: file.name,
      }),
    });
  } catch {
    throwNormalized('Network error', 0);
  }

  if (!startRes.ok) {
    throwNormalized(await readErrorMessage(startRes), startRes.status);
  }

  const startJson = (await startRes.json()) as StartUploadResponse;
  const uploadId = startJson.uploadId;
  const chunkBytes =
    typeof startJson.chunkBytes === 'number' && startJson.chunkBytes > 0
      ? startJson.chunkBytes
      : CHUNK_BYTES;

  // If server uses a different chunk size, recompute and restart the session.
  const effectiveChunks =
    totalBytes === 0 ? 1 : Math.ceil(totalBytes / chunkBytes);
  let sessionId = uploadId;
  let chunks = totalChunks;
  let size = chunkBytes;

  if (effectiveChunks !== totalChunks || chunkBytes !== CHUNK_BYTES) {
    chunks = effectiveChunks;
    size = chunkBytes;
    let restart: Response;
    try {
      restart = await fetch(uploadBasePath, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...csrfHeaders(),
        },
        body: JSON.stringify({
          totalBytes,
          totalChunks: chunks,
          filename: file.name,
        }),
      });
    } catch {
      throwNormalized('Network error', 0);
    }
    if (!restart.ok) {
      throwNormalized(await readErrorMessage(restart), restart.status);
    }
    sessionId = ((await restart.json()) as StartUploadResponse).uploadId;
  }

  for (let chunkIndex = 0; chunkIndex < chunks; chunkIndex++) {
    const start = chunkIndex * size;
    const end = totalBytes === 0 ? 0 : Math.min(totalBytes, start + size);
    const blob = file.slice(start, end);
    const url =
      `${uploadBasePath}/${encodeURIComponent(sessionId)}/chunks/${chunkIndex}` +
      `?totalChunks=${chunks}&totalBytes=${totalBytes}`;

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/octet-stream',
          ...csrfHeaders(),
        },
        body: blob,
      });
    } catch {
      throwNormalized('Network error', 0);
    }

    if (!res.ok) {
      throwNormalized(await readErrorMessage(res), res.status);
    }
  }

  hooks?.onPhase?.('importing');

  let finishRes: Response;
  try {
    finishRes = await fetch(
      `${uploadBasePath}/${encodeURIComponent(sessionId)}/finish`,
      {
        method: 'POST',
        credentials: 'include',
        headers: csrfHeaders(),
      },
    );
  } catch {
    throwNormalized('Network error', 0);
  }

  if (finishRes.status === 202 || finishRes.status === 409) return;
  if (!finishRes.ok) {
    throwNormalized(await readErrorMessage(finishRes), finishRes.status);
  }
}
