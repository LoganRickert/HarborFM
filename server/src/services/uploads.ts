import { createWriteStream, existsSync, unlinkSync } from 'fs';
import { pipeline } from 'stream/promises';
import { Transform } from 'stream';

export class FileTooLargeError extends Error {
  constructor(message = 'File too large') {
    super(message);
    this.name = 'FileTooLargeError';
  }
}

/**
 * Stream an incoming file to disk while counting bytes and enforcing a max size.
 * Returns total bytes written. Deletes partial file on error.
 */
export async function streamToFileWithLimit(
  input: NodeJS.ReadableStream,
  destPath: string,
  maxBytes: number
): Promise<number> {
  let bytes = 0;
  const counter = new Transform({
    transform(chunk, _enc, cb) {
      bytes += Buffer.byteLength(chunk as Buffer);
      if (bytes > maxBytes) {
        cb(new FileTooLargeError());
        return;
      }
      cb(null, chunk);
    },
  });

  const out = createWriteStream(destPath, { flags: 'w' });
  try {
    await pipeline(input, counter, out);
    return bytes;
  } catch (err) {
    try {
      if (existsSync(destPath)) unlinkSync(destPath);
    } catch {
      // ignore cleanup errors
    }
    throw err;
  }
}

