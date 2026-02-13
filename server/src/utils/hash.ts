import { createHash } from "crypto";

export const MD5_SUFFIX = ".md5";

/** MD5 hash of buffer as 32-char hex string (for .md5 sidecar skip check). */
export function md5Hex(buffer: Buffer): string {
  return createHash("md5").update(buffer).digest("hex");
}

/** SHA-256 hash of string as 64-char hex (for API key lookup). */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
