import { basename } from "path";

/**
 * Redact sensitive fields from a segment before sending to clients.
 * Replaces audio_path (filesystem path) with basename-only for cache busting
 * without exposing server directory structure.
 */
export function redactSegmentForClient(
  segment: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...segment };
  const path = out.audio_path;
  if (path != null && typeof path === "string" && path.length > 0) {
    out.audio_path = basename(path);
  }
  return out;
}
