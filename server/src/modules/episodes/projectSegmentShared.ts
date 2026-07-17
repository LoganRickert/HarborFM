import { existsSync, readdirSync, readFileSync } from "fs";
import { basename, join } from "path";
import { sha256FileSync } from "../../utils/hash.js";
import type { MultitrackManifest } from "../../services/multitrackRemake.js";

export type SegmentProjectJson = {
  type?: "recorded" | "reusable";
  position?: number;
  name?: string | null;
  durationSec?: number;
  trimRanges?: unknown;
  markers?: unknown;
  audioEq?: unknown;
  disabled?: boolean;
  reusableAssetId?: string | null;
  audioFile?: string | null;
  audioSource?: "recorded" | "library" | null;
  hasRecordings?: boolean;
  audioSha256?: string | null;
  waveformSha256?: string | null;
  segmentRppSha256?: string | null;
  audacityLofSha256?: string | null;
  timelineOtioSha256?: string | null;
};

export function readJsonFile<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function stringifyJsonField(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

export function findFirstFile(dir: string, prefix: string): string | null {
  if (!existsSync(dir)) return null;
  const names = readdirSync(dir).filter((n) => n.startsWith(prefix));
  return names.length ? join(dir, names[0]) : null;
}

/** Prefer audio.mp3, then audio.wav, then any audio.* */
export function findSegmentAudioFile(
  segDir: string,
  preferred?: string | null,
): string | null {
  if (preferred) {
    const p = join(segDir, basename(preferred));
    if (existsSync(p)) return p;
  }
  const mp3 = join(segDir, "audio.mp3");
  if (existsSync(mp3)) return mp3;
  const wav = join(segDir, "audio.wav");
  if (existsSync(wav)) return wav;
  return findFirstFile(segDir, "audio.");
}

export function nameFromSegmentFolder(folder: string): string {
  const stripped = folder.replace(/^\d+_/, "").replace(/_/g, " ").trim();
  return stripped || folder;
}

export function rewriteManifestPaths(manifest: unknown): unknown {
  if (!manifest || typeof manifest !== "object") return manifest;
  const obj = manifest as Record<string, unknown>;
  const rewritePath = (p: unknown): unknown => {
    if (typeof p !== "string") return p;
    return basename(p.replace(/\\/g, "/"));
  };
  const rewriteEntry = (t: unknown): unknown => {
    if (!t || typeof t !== "object") return t;
    const track = { ...(t as Record<string, unknown>) };
    if ("path" in track) track.path = rewritePath(track.path);
    if ("filePath" in track) track.filePath = rewritePath(track.filePath);
    if ("filename" in track) track.filename = rewritePath(track.filename);
    return track;
  };
  if (Array.isArray(obj.tracks)) {
    obj.tracks = obj.tracks.map(rewriteEntry);
  }
  if (Array.isArray(obj.segments)) {
    obj.segments = obj.segments.map(rewriteEntry);
  }
  if (Array.isArray(obj.files)) {
    obj.files = obj.files.map((f) => rewritePath(f));
  }
  return obj;
}

/**
 * True when any manifest track is missing on disk (treated as deleted) or its
 * file hash differs from the export-time fileSha256.
 */
export function recordingsTracksChanged(
  mtDir: string,
  manifest: MultitrackManifest,
): boolean {
  const segments = Array.isArray(manifest.segments) ? manifest.segments : [];
  for (const entry of segments) {
    const rel = typeof entry.filePath === "string" ? entry.filePath : null;
    if (!rel) continue;
    const trackAbs = join(mtDir, basename(rel.replace(/\\/g, "/")));
    if (!existsSync(trackAbs)) return true;
    if (typeof entry.fileSha256 !== "string" || !entry.fileSha256) continue;
    const current = sha256FileSync(trackAbs);
    if (current && current !== entry.fileSha256) return true;
  }
  return false;
}

/**
 * Drop manifest entries whose audio file is missing (intentionally deleted from
 * the zip). Remake uses the remaining tracks only.
 */
export function pruneMissingManifestTracks(
  mtDir: string,
  manifest: MultitrackManifest,
): MultitrackManifest {
  const segments = Array.isArray(manifest.segments) ? manifest.segments : [];
  const kept = segments.filter((entry) => {
    const rel = typeof entry.filePath === "string" ? entry.filePath : null;
    if (!rel) return false;
    return existsSync(join(mtDir, basename(rel.replace(/\\/g, "/"))));
  });
  return { ...manifest, segments: kept };
}
