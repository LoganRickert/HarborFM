import { basename } from "path";

/**
 * Redact sensitive fields from a segment before sending to clients.
 * Replaces audioPath (filesystem path) with basename-only for cache busting
 * without exposing server directory structure.
 * Parses trimRanges and markers from JSON strings to arrays/objects.
 * Input and output are camelCase only.
 */
export function redactSegmentForClient(
  segment: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: segment.id,
    episodeId: segment.episodeId,
    position: segment.position,
    type: segment.type,
    name: segment.name,
    reusableAssetId: segment.reusableAssetId,
    audioPath: segment.audioPath,
    durationSec: segment.durationSec,
    createdAt: segment.createdAt,
    inProgress: segment.inProgress,
    recordFailed: segment.recordFailed,
    trimRanges: segment.trimRanges,
    markers: segment.markers,
    audioEq: segment.audioEq,
    assetName: segment.assetName,
    waveformExists: segment.waveformExists,
  };
  const path = segment.audioPath;
  if (path != null && typeof path === "string" && path.length > 0) {
    out.audioPath = basename(path);
  }
  const trimRaw = segment.trimRanges;
  if (typeof trimRaw === "string" && trimRaw) {
    try {
      out.trimRanges = JSON.parse(trimRaw);
    } catch {
      out.trimRanges = null;
    }
  }
  const markersRaw = segment.markers;
  if (typeof markersRaw === "string" && markersRaw) {
    try {
      out.markers = JSON.parse(markersRaw);
    } catch {
      out.markers = null;
    }
  }
  const audioEqRaw = segment.audioEq;
  if (typeof audioEqRaw === "string" && audioEqRaw) {
    try {
      out.audioEq = JSON.parse(audioEqRaw);
    } catch {
      out.audioEq = null;
    }
  }
  return out;
}
