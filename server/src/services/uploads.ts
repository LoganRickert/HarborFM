import { createWriteStream, existsSync, unlinkSync } from "fs";
import { pipeline } from "stream/promises";
import { Transform } from "stream";

export class FileTooLargeError extends Error {
  constructor(message = "File too large") {
    super(message);
    this.name = "FileTooLargeError";
  }
}

/** Map audio mimetype to file extension for uploads. Order matters: more specific first. */
const MIMETYPE_TO_EXT: Array<{ match: (m: string) => boolean; ext: string }> = [
  { match: (m) => m.includes("wav"), ext: "wav" },
  { match: (m) => m.includes("webm"), ext: "webm" },
  { match: (m) => m.includes("ogg"), ext: "ogg" },
  { match: (m) => m.includes("m4a") || m.includes("mp4"), ext: "m4a" },
  { match: (m) => m.includes("flac"), ext: "flac" },
  { match: (m) => m.includes("mp3") || m.includes("mpeg"), ext: "mp3" },
];

export function extensionFromAudioMimetype(mimetype: string): string {
  const m = mimetype.toLowerCase();
  for (const { match, ext } of MIMETYPE_TO_EXT) {
    if (match(m)) return ext;
  }
  return "mp3";
}

/**
 * Stream an incoming file to disk while counting bytes and enforcing a max size.
 * Returns total bytes written. Deletes partial file on error.
 */
export async function streamToFileWithLimit(
  input: NodeJS.ReadableStream,
  destPath: string,
  maxBytes: number,
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

  const out = createWriteStream(destPath, { flags: "w" });
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
