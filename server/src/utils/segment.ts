import { basename } from "path";

/**
 * Redact sensitive fields from a segment before sending to clients.
 * Replaces audio_path (filesystem path) with basename-only for cache busting
 * without exposing server directory structure.
 * Parses trim_ranges and markers from JSON strings to arrays/objects.
 */
export function redactSegmentForClient(
  segment: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...segment };
  const path = out.audio_path;
  if (path != null && typeof path === "string" && path.length > 0) {
    out.audio_path = basename(path);
  }
  if (typeof out.trim_ranges === "string" && out.trim_ranges) {
    try {
      out.trim_ranges = JSON.parse(out.trim_ranges as string);
    } catch {
      out.trim_ranges = null;
    }
  }
  if (typeof out.markers === "string" && out.markers) {
    try {
      out.markers = JSON.parse(out.markers as string);
    } catch {
      out.markers = null;
    }
  }
  return out;
}
