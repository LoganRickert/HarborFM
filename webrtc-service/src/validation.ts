import { resolve, sep } from "path";

/** Only allow IDs that cannot be used for path traversal (nanoid-style: alphanumeric, hyphen, underscore). */
const SAFE_ID = /^[a-zA-Z0-9_-]+$/;

/** filePathRelative must be under recordings/ and not contain path traversal. */
const SAFE_RELATIVE_PATH = /^recordings\/[a-zA-Z0-9_.-]+(\/[a-zA-Z0-9_.-]+)*$/;

export function assertSafeId(id: string, name: string): void {
  if (typeof id !== "string" || !SAFE_ID.test(id)) {
    throw new Error(`Invalid ${name}: disallowed characters`);
  }
}

export function assertSafeFilePathRelative(
  filePathRelative: string,
  recordingDataDir: string
): void {
  if (typeof filePathRelative !== "string" || filePathRelative.includes("..")) {
    throw new Error("Invalid filePathRelative: path traversal not allowed");
  }
  if (!SAFE_RELATIVE_PATH.test(filePathRelative)) {
    throw new Error("Invalid filePathRelative: must be under recordings/");
  }
  const base = resolve(recordingDataDir, "recordings");
  const resolved = resolve(recordingDataDir, filePathRelative);
  if (resolved !== base && !resolved.startsWith(base + sep)) {
    throw new Error("Invalid filePathRelative: path escapes recordings directory");
  }
}

/** Filter directory names that could cause path traversal when used in join(). */
export function isSafeDirectoryName(name: string): boolean {
  return typeof name === "string" && name !== "" && !name.includes("..") && !name.includes("/") && !name.includes("\\");
}

/** Filter file names that could cause path traversal when used in join(). Reject names with .., /, or \. */
export function isSafeFileName(name: string): boolean {
  return typeof name === "string" && name !== "" && !name.includes("..") && !name.includes("/") && !name.includes("\\");
}

const MAX_PARTICIPANT_NAME_LEN = 128;

/** Sanitize participant name for storage: trim, limit length, strip control chars. */
export function sanitizeParticipantName(value: string): string {
  const s = typeof value === "string" ? value.trim() : "";
  if (s.length === 0) return "";
  const safe = [...s].filter((c) => {
    const n = c.charCodeAt(0);
    return n >= 32 && n !== 127 && (n < 128 || n > 159);
  }).join("");
  return safe.slice(0, MAX_PARTICIPANT_NAME_LEN);
}
