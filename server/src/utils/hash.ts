import { createHash } from "crypto";
import { createReadStream, existsSync, readFileSync } from "fs";

export const MD5_SUFFIX = ".md5";

/** MD5 hash of buffer as 32-char hex string (for .md5 sidecar skip check). */
export function md5Hex(buffer: Buffer): string {
  return createHash("md5").update(buffer).digest("hex");
}

/** SHA-256 hash of string as 64-char hex (for API key lookup). */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** SHA-256 hash of a file on disk as 64-char hex. Returns null if missing/unreadable. */
export async function sha256File(path: string): Promise<string | null> {
  if (!path || !existsSync(path)) return null;
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", (err) => reject(err));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

/** Sync SHA-256 of a file (export metadata). Returns null if missing. */
export function sha256FileSync(path: string): string | null {
  if (!path || !existsSync(path)) return null;
  try {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  } catch {
    return null;
  }
}
