import { getReusableAssetById } from "./repo.js";

/** Max length for soundboard display names in tracks_manifest. */
const SOUNDBOARD_NAME_MAX = 80;

/**
 * Build the participantName used for soundboard clips in tracks_manifest.
 * Always starts with "Soundboard" so editors/DAW exports read clearly as board plays.
 */
export function soundboardManifestParticipantName(assetName?: string | null): string {
  const raw = typeof assetName === "string" ? assetName.trim() : "";
  if (!raw) return "Soundboard";
  const cleaned = raw.replace(/\s+/g, " ").slice(0, SOUNDBOARD_NAME_MAX);
  return `Soundboard: ${cleaned}`;
}

type ManifestSegment = {
  source?: unknown;
  soundboardAssetId?: unknown;
  participantName?: unknown;
  [key: string]: unknown;
};

type TracksManifestLike = {
  segments?: ManifestSegment[];
  [key: string]: unknown;
};

/**
 * Ensure every soundboard segment in a tracks_manifest has source + an explicit
 * Soundboard participantName (resolving library asset names when possible).
 */
export function labelSoundboardSegmentsInManifest(manifest: unknown): unknown {
  if (!manifest || typeof manifest !== "object") return manifest;
  const m = manifest as TracksManifestLike;
  if (!Array.isArray(m.segments)) return manifest;

  const nameByAssetId = new Map<string, string>();
  for (const seg of m.segments) {
    if (seg?.source !== "soundboard") continue;
    const assetId =
      typeof seg.soundboardAssetId === "string" ? seg.soundboardAssetId.trim() : "";
    if (!assetId || nameByAssetId.has(assetId)) continue;
    const row = getReusableAssetById(assetId);
    nameByAssetId.set(assetId, row?.name?.trim() || "");
  }

  const labeled = m.segments.map((seg) => {
    if (!seg || typeof seg !== "object") return seg;
    const isSoundboard =
      seg.source === "soundboard" ||
      (typeof seg.soundboardAssetId === "string" &&
        seg.soundboardAssetId.trim().length > 0);
    if (!isSoundboard) return seg;

    const assetId =
      typeof seg.soundboardAssetId === "string" ? seg.soundboardAssetId.trim() : "";
    const assetName = assetId ? nameByAssetId.get(assetId) ?? "" : "";
    return {
      ...seg,
      source: "soundboard",
      participantName: soundboardManifestParticipantName(assetName),
    };
  });

  return {
    ...m,
    segments: trimOverlappingSoundboardManifestSegments(labeled),
  };
}

function manifestSegStartMs(seg: ManifestSegment): number {
  const raw =
    typeof seg.startMs === "number" && Number.isFinite(seg.startMs)
      ? seg.startMs
      : 0;
  return Math.max(0, raw);
}

function manifestSegEndMs(seg: ManifestSegment): number {
  const start = manifestSegStartMs(seg);
  if (typeof seg.lengthMs === "number" && seg.lengthMs > 0) {
    return start + seg.lengthMs;
  }
  if (typeof seg.endMs === "number" && seg.endMs > start) return seg.endMs;
  return start;
}

function isSoundboardManifestSeg(seg: ManifestSegment): boolean {
  if (seg.source === "soundboard") return true;
  return (
    typeof seg.soundboardAssetId === "string" &&
    seg.soundboardAssetId.trim().length > 0
  );
}

/** Trim earlier soundboard plays when a later one overlaps (shared lane). */
function trimOverlappingSoundboardManifestSegments(
  segments: ManifestSegment[],
): ManifestSegment[] {
  const sbIndices: number[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg && isSoundboardManifestSeg(seg)) sbIndices.push(i);
  }
  if (sbIndices.length < 2) return segments;

  const ordered = [...sbIndices].sort(
    (a, b) =>
      manifestSegStartMs(segments[a]!) - manifestSegStartMs(segments[b]!) ||
      a - b,
  );

  const next = segments.map((s) => (s && typeof s === "object" ? { ...s } : s));
  for (let i = 0; i < ordered.length - 1; i++) {
    const curI = ordered[i]!;
    const nxtI = ordered[i + 1]!;
    const cur = next[curI];
    const nxt = next[nxtI];
    if (!cur || !nxt) continue;
    const nextStart = manifestSegStartMs(nxt);
    const curStart = manifestSegStartMs(cur);
    const curEnd = manifestSegEndMs(cur);
    if (curEnd <= nextStart) continue;
    if (nextStart <= curStart) {
      next[curI] = { ...cur, lengthMs: 0, endMs: curStart };
      continue;
    }
    next[curI] = {
      ...cur,
      lengthMs: nextStart - curStart,
      endMs: nextStart,
    };
  }

  return next.filter((seg) => {
    if (!seg || !isSoundboardManifestSeg(seg)) return true;
    return manifestSegEndMs(seg) - manifestSegStartMs(seg) >= 1;
  });
}
