import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "fs";
import { basename, join, resolve, sep } from "path";
import { nanoid } from "nanoid";
import { assertPathUnder } from "../../services/paths.js";
import type {
  MultitrackManifest,
  MultitrackSegmentEntry,
} from "../../services/multitrackRemake.js";
import { sha256FileSync } from "../../utils/hash.js";
import {
  ensureOriginalTracksManifest,
  ImportValidationError,
} from "./projectSegmentShared.js";
import { isAudioFilename } from "./projectDawSidecars.js";

export const TIMELINE_OTIO_NAME = "timeline.otio";

const OTIO_READ_ERROR = "There was an error reading the OTIO file.";

/** User-facing notice when import falls back after an unreadable timeline.otio. */
export const OTIO_IGNORED_WARNING =
  "There was an error reading the OTIO file. It was ignored.";

export type ApplyOtioResult =
  | { ok: true; manifest: MultitrackManifest; bytesAdded: number }
  | { ok: false; error: string };

type JsonObj = Record<string, unknown>;

function asObj(v: unknown): JsonObj | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as JsonObj)
    : null;
}

function schemaName(node: JsonObj | null): string {
  if (!node) return "";
  return typeof node.OTIO_SCHEMA === "string" ? node.OTIO_SCHEMA : "";
}

function schemaKind(schema: string): string {
  const base = schema.split(".")[0] || "";
  return base;
}

/** RationalTime → seconds (value / rate). */
export function rationalTimeToSeconds(rt: unknown): number | null {
  const obj = asObj(rt);
  if (!obj) return null;
  const value = typeof obj.value === "number" ? obj.value : Number(obj.value);
  const rate = typeof obj.rate === "number" ? obj.rate : Number(obj.rate);
  if (!Number.isFinite(value) || !Number.isFinite(rate) || rate === 0) {
    return null;
  }
  return value / rate;
}

function timeRangeSeconds(range: unknown): {
  startSec: number;
  durationSec: number;
} | null {
  const obj = asObj(range);
  if (!obj) return null;
  const startSec = rationalTimeToSeconds(obj.start_time) ?? 0;
  const durationSec = rationalTimeToSeconds(obj.duration);
  if (durationSec == null || durationSec < 0) return null;
  return { startSec: Math.max(0, startSec), durationSec };
}

function isEnabled(node: JsonObj): boolean {
  return node.enabled !== false;
}

/** Basename from Windows/Unix absolute or relative media URLs. */
export function mediaBasenameFromTargetUrl(targetUrl: string): string {
  const normalized = targetUrl.replace(/\\/g, "/").trim();
  if (!normalized) return "";
  return basename(normalized);
}

function clipMediaBasename(clip: JsonObj): string | null {
  const activeKey =
    typeof clip.active_media_reference_key === "string"
      ? clip.active_media_reference_key
      : null;
  const refs = asObj(clip.media_references);
  if (refs) {
    const keys = [
      ...(activeKey ? [activeKey] : []),
      "DEFAULT_MEDIA",
      ...Object.keys(refs),
    ];
    const seen = new Set<string>();
    for (const key of keys) {
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const ref = asObj(refs[key]);
      const url = ref && typeof ref.target_url === "string" ? ref.target_url : "";
      const base = mediaBasenameFromTargetUrl(url);
      if (base && isAudioFilename(base)) return base;
    }
  }

  const singular = asObj(clip.media_reference);
  if (singular && typeof singular.target_url === "string") {
    const base = mediaBasenameFromTargetUrl(singular.target_url);
    if (base && isAudioFilename(base)) return base;
    // HarborFM export: relative path under segment folder.
    const rel = singular.target_url.replace(/\\/g, "/").trim();
    if (rel && !/^[a-zA-Z]:\//.test(rel) && !rel.startsWith("/")) {
      const fromRel = basename(rel);
      if (fromRel && isAudioFilename(fromRel)) return fromRel;
    }
  }

  if (typeof clip.name === "string" && isAudioFilename(clip.name.trim())) {
    return clip.name.trim();
  }
  return null;
}

/**
 * Locate clip media under recordings/, mtDest, or a relative target_url
 * under the segment folder. Absolute Resolve paths are matched by basename.
 */
function resolveOtioMediaAbs(
  segDir: string,
  mtDest: string,
  clip: JsonObj,
  mediaBasename: string,
): string | null {
  const candidates: string[] = [
    join(segDir, "recordings", mediaBasename),
    join(mtDest, mediaBasename),
    join(segDir, mediaBasename),
  ];

  const singular = asObj(clip.media_reference);
  const relUrl =
    singular && typeof singular.target_url === "string"
      ? singular.target_url.replace(/\\/g, "/").trim()
      : "";
  if (
    relUrl &&
    !relUrl.startsWith("/") &&
    !relUrl.startsWith("~") &&
    !/^[a-zA-Z]:\//.test(relUrl) &&
    !relUrl.split("/").includes("..")
  ) {
    candidates.unshift(join(segDir, ...relUrl.split("/").filter(Boolean)));
  }

  for (const abs of candidates) {
    if (!existsSync(abs) || !statSync(abs).isFile()) continue;
    try {
      return assertPathUnder(abs, segDir);
    } catch {
      // mtDest may sit outside segDir (server multitrack store).
      try {
        return assertPathUnder(abs, mtDest);
      } catch {
        continue;
      }
    }
  }
  return null;
}

function uniqueBasenameInDir(dir: string, preferred: string): string {
  const safe = basename(preferred.replace(/\\/g, "/"));
  if (!safe || safe === "." || safe === "..") {
    return `track_${nanoid()}.mp3`;
  }
  if (!existsSync(join(dir, safe))) return safe;
  const ext = safe.includes(".") ? safe.slice(safe.lastIndexOf(".")) : "";
  const stem = ext ? safe.slice(0, -ext.length) : safe;
  for (let i = 2; i < 10_000; i++) {
    const candidate = `${stem}_${i}${ext}`;
    if (!existsSync(join(dir, candidate))) return candidate;
  }
  return `${stem}_${nanoid()}${ext}`;
}

function copyMediaBytes(
  mediaAbs: string,
  mtDest: string,
): { basename: string; bytesAdded: number } {
  mkdirSync(mtDest, { recursive: true });
  const preferred = basename(mediaAbs);
  const mtResolved = resolve(mtDest);
  const mediaResolved = resolve(mediaAbs);

  if (
    mediaResolved === mtResolved ||
    mediaResolved.startsWith(mtResolved + sep)
  ) {
    return { basename: preferred, bytesAdded: 0 };
  }

  const existing = join(mtDest, preferred);
  if (existsSync(existing)) {
    return { basename: preferred, bytesAdded: 0 };
  }

  const destName = uniqueBasenameInDir(mtDest, preferred);
  const destAbs = join(mtDest, destName);
  copyFileSync(mediaAbs, destAbs);
  return { basename: destName, bytesAdded: statSync(destAbs).size };
}

function mediaStem(name: string): string {
  return name.replace(/\.[^.]+$/, "") || name;
}

function findPriorManifestEntry(
  existingManifest: MultitrackManifest | null,
  mediaBasename: string,
): MultitrackSegmentEntry | null {
  const segments = existingManifest?.segments;
  if (!Array.isArray(segments)) return null;
  const want = mediaBasename.replace(/\\/g, "/");
  for (const entry of segments) {
    const rel = typeof entry.filePath === "string" ? entry.filePath : null;
    if (!rel) continue;
    if (basename(rel.replace(/\\/g, "/")) === want) return entry;
  }
  return null;
}

function isHarborParticipantLaneName(trackName: string): boolean {
  return /^.+_\d+$/.test(trackName.trim());
}

function classifyOtioTrack(
  trackName: string,
  mediaBasename: string,
  existingManifest: MultitrackManifest | null,
): Pick<
  MultitrackSegmentEntry,
  "source" | "participantName" | "participantId" | "soundboardAssetId"
> {
  const prior = findPriorManifestEntry(existingManifest, mediaBasename);
  if (prior) {
    if (prior.source === "soundboard") {
      return {
        source: "soundboard",
        soundboardAssetId:
          (typeof prior.soundboardAssetId === "string" &&
            prior.soundboardAssetId.trim()) ||
          mediaStem(mediaBasename),
        participantName: null,
        participantId: null,
      };
    }
    return {
      source: typeof prior.source === "string" ? prior.source : null,
      participantName:
        (typeof prior.participantName === "string" &&
          prior.participantName.trim()) ||
        trackName,
      participantId:
        typeof prior.participantId === "string" ? prior.participantId : null,
      soundboardAssetId: null,
    };
  }

  if (trackName.startsWith("soundboard_")) {
    return {
      source: "soundboard",
      soundboardAssetId:
        trackName.slice("soundboard_".length).trim() ||
        mediaStem(mediaBasename),
      participantName: null,
      participantId: null,
    };
  }

  if (isHarborParticipantLaneName(trackName)) {
    return {
      participantName: trackName,
      participantId: null,
      soundboardAssetId: null,
    };
  }

  return {
    source: "soundboard",
    soundboardAssetId: trackName.trim() || mediaStem(mediaBasename),
    participantName: null,
    participantId: null,
  };
}

function entryFromOtioClip(opts: {
  trackName: string;
  mediaBasename: string;
  startSec: number;
  lengthSec: number;
  sourceOffsetSec: number;
  existingManifest: MultitrackManifest | null;
}): MultitrackSegmentEntry {
  const startMs = Math.round(opts.startSec * 1000);
  const sourceOffsetMs = Math.round(opts.sourceOffsetSec * 1000);
  const lengthMs = Math.round(opts.lengthSec * 1000);
  const endMs = lengthMs > 0 ? startMs + lengthMs : undefined;

  const classified = classifyOtioTrack(
    opts.trackName,
    opts.mediaBasename,
    opts.existingManifest,
  );

  const entry: MultitrackSegmentEntry = {
    segmentId: nanoid(),
    startMs,
    filePath: opts.mediaBasename,
  };
  if (classified.participantName) {
    entry.participantName = classified.participantName;
  }
  if (classified.participantId) {
    entry.participantId = classified.participantId;
  }
  if (classified.source) {
    entry.source = classified.source;
  }
  if (classified.soundboardAssetId) {
    entry.soundboardAssetId = classified.soundboardAssetId;
  }
  if (sourceOffsetMs > 0) entry.sourceOffsetMs = sourceOffsetMs;
  if (lengthMs > 0) entry.lengthMs = lengthMs;
  if (endMs != null) entry.endMs = endMs;
  return entry;
}

function trackHasAudioClips(track: JsonObj): boolean {
  const kind =
    typeof track.kind === "string" ? track.kind.trim().toLowerCase() : "";
  if (kind === "video") return false;
  const children = Array.isArray(track.children) ? track.children : [];
  for (const child of children) {
    const obj = asObj(child);
    if (!obj) continue;
    if (schemaKind(schemaName(obj)) !== "Clip") continue;
    if (clipMediaBasename(obj)) return true;
  }
  return false;
}

/** True when timeline.otio exists and its hash differs from the stored export hash. */
export function timelineOtioNeedsApply(
  segDir: string,
  storedHash: string | null | undefined,
): boolean {
  const path = join(segDir, TIMELINE_OTIO_NAME);
  if (!existsSync(path)) return false;
  const current = sha256FileSync(path);
  if (!current) return false;
  if (typeof storedHash !== "string" || !storedHash) return true;
  return current !== storedHash;
}

/**
 * Parse Resolve / HarborFM timeline.otio, rebuild tracks_manifest segments from
 * clip timing (gaps + source_range), and copy referenced media into mtDest.
 * Fairlight / Resolve FX are ignored in v1. Unreadable OTIO returns
 * `{ ok: false }` so import can fall back to tracks_manifest.json.
 */
export function applyOtioTimelineToManifest(opts: {
  segDir: string;
  mtDest: string;
  existingManifest: MultitrackManifest | null;
}): ApplyOtioResult {
  const { segDir, mtDest, existingManifest } = opts;
  const otioPath = join(segDir, TIMELINE_OTIO_NAME);
  if (!existsSync(otioPath)) {
    throw new ImportValidationError("timeline.otio is missing");
  }
  assertPathUnder(otioPath, segDir);
  mkdirSync(mtDest, { recursive: true });

  let root: JsonObj;
  try {
    root = JSON.parse(readFileSync(otioPath, "utf8")) as JsonObj;
  } catch {
    return { ok: false, error: OTIO_READ_ERROR };
  }

  if (schemaKind(schemaName(root)) !== "Timeline") {
    return { ok: false, error: OTIO_READ_ERROR };
  }

  const stack = asObj(root.tracks);
  if (!stack || schemaKind(schemaName(stack)) !== "Stack") {
    return { ok: false, error: OTIO_READ_ERROR };
  }

  const tracks = Array.isArray(stack.children) ? stack.children : [];
  const segments: MultitrackSegmentEntry[] = [];
  let bytesAdded = 0;

  for (const trackRaw of tracks) {
    const track = asObj(trackRaw);
    if (!track || schemaKind(schemaName(track)) !== "Track") continue;
    if (!trackHasAudioClips(track)) continue;

    const trackName =
      typeof track.name === "string" && track.name.trim()
        ? track.name.trim()
        : "Track";
    const children = Array.isArray(track.children) ? track.children : [];
    let cursorSec = 0;

    for (const childRaw of children) {
      const child = asObj(childRaw);
      if (!child) continue;
      const kind = schemaKind(schemaName(child));
      const range = timeRangeSeconds(child.source_range);
      if (!range) continue;
      const { startSec: sourceOffsetSec, durationSec } = range;

      if (kind === "Gap") {
        if (isEnabled(child) || durationSec > 0) {
          cursorSec += durationSec;
        }
        continue;
      }

      if (kind !== "Clip") continue;

      if (!isEnabled(child)) {
        cursorSec += durationSec;
        continue;
      }

      const mediaBase = clipMediaBasename(child);
      if (!mediaBase) {
        cursorSec += durationSec;
        continue;
      }
      if (!isAudioFilename(mediaBase)) {
        throw new ImportValidationError(
          `timeline.otio references unsupported media type: ${mediaBase}. Use MP3 or WAV under recordings/.`,
        );
      }

      const mediaAbs = resolveOtioMediaAbs(segDir, mtDest, child, mediaBase);
      if (!mediaAbs) {
        console.warn(
          `[projectImport] Skipping missing OTIO media: ${mediaBase}`,
        );
        cursorSec += durationSec;
        continue;
      }

      const copied = copyMediaBytes(mediaAbs, mtDest);
      bytesAdded += copied.bytesAdded;

      segments.push(
        entryFromOtioClip({
          trackName,
          mediaBasename: copied.basename,
          startSec: cursorSec,
          lengthSec: durationSec,
          sourceOffsetSec,
          existingManifest,
        }),
      );
      cursorSec += durationSec;
    }
  }

  if (segments.length === 0) {
    throw new ImportValidationError(
      "timeline.otio has no usable audio clips. Keep media under recordings/, re-export from Resolve, re-zip, and import again.",
    );
  }

  const manifest: MultitrackManifest = {
    ...(existingManifest ?? {}),
    segments,
  };
  ensureOriginalTracksManifest(mtDest);
  writeFileSync(
    join(mtDest, "tracks_manifest.json"),
    JSON.stringify(manifest, null, 2),
  );
  return { ok: true, manifest, bytesAdded };
}
