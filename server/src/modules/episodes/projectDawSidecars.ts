import { execFile } from "child_process";
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "fs";
import { basename, extname, join } from "path";
import { promisify } from "util";
import { APP_NAME, FFPROBE_PATH } from "../../config.js";
import { assertPathUnder } from "../../services/paths.js";

const exec = promisify(execFile);

const AUDIO_EXTS = new Set([
  ".mp3",
  ".wav",
  ".m4a",
  ".flac",
  ".ogg",
  ".aiff",
  ".aif",
]);

const OTIO_RATE = 48000;

/** Skip near-empty / stalled recording stubs (mix also skips under 1KB). */
const MIN_DAW_MEDIA_BYTES = 2048;

export type DawMarker = {
  time: number;
  title?: string;
  markerType?: "" | "chapter" | "soundbite";
  duration?: number;
  /** UI swatch hex (e.g. #3b82f6); mapped to OTIO marker color names. */
  color?: string;
};

/** Same palette as web SegmentEditTab / ChaptersCard / SoundbitesCard. */
const UI_MARKER_COLORS = [
  "#3b82f6",
  "#22c55e",
  "#ef4444",
  "#eab308",
  "#a855f7",
  "#f97316",
  "#06b6d4",
  "#ec4899",
] as const;

/**
 * Marker colors written into OTIO for Resolve.
 * Most match OTIO Marker.2 enums. OTIO "ORANGE" imports as Green in Resolve,
 * so HarborFM orange uses YELLOW (works), and UI yellow uses Resolve "Lemon".
 */
const UI_HEX_TO_OTIO_COLOR: Record<string, string> = {
  "#3b82f6": "BLUE",
  "#22c55e": "GREEN",
  "#ef4444": "RED",
  "#eab308": "Lemon",
  "#a855f7": "PURPLE",
  "#f97316": "YELLOW",
  "#06b6d4": "CYAN",
  "#ec4899": "PINK",
};

/** One media item; paths are relative to the segment folder. */
export type SegmentTrackClip = {
  /** Clip/item label (filename stem or segment id). */
  name: string;
  mediaPath: string;
  durationSec: number;
  /** Timeline start offset in seconds (from tracks_manifest startMs). */
  startSec: number;
  participantId?: string | null;
  participantName?: string | null;
  source?: string | null;
  soundboardAssetId?: string | null;
};

/** One Reaper/Resolve track; may hold several clips (e.g. reconnects). */
export type DawLane = {
  name: string;
  kind: "participant" | "soundboard" | "other";
  clips: SegmentTrackClip[];
};

export function isAudioFilename(name: string): boolean {
  return AUDIO_EXTS.has(extname(name).toLowerCase());
}

/** List audio filenames directly under dir (not recursive). */
export function listAudioFilesInDir(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => {
      try {
        return statSync(join(dir, n)).isFile() && isAudioFilename(n);
      } catch {
        return false;
      }
    })
    .sort((a, b) => a.localeCompare(b));
}

/** Recording audio paths relative to segment folder (recordings/foo.mp3). */
export function listRecordingRelPaths(segDir: string): string[] {
  const recDir = join(segDir, "recordings");
  return listAudioFilesInDir(recDir).map((n) => `recordings/${n}`);
}

function escapeRppString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Safe track label for Reaper / Resolve (Logan_0, soundboard_abc). */
function sanitizeTrackLabel(s: string): string {
  const t = s
    .trim()
    .replace(/[^\w-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return t || "track";
}

/** Format seconds for RPP / LOF numeric fields (avoid scientific notation). */
function fmtRppSec(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return "0";
  return (Math.round(sec * 1000) / 1000).toString();
}

function isUsableDawMedia(absPath: string): boolean {
  try {
    const st = statSync(absPath);
    return st.isFile() && st.size >= MIN_DAW_MEDIA_BYTES;
  } catch {
    return false;
  }
}

function reaperSourceTag(filename: string): string {
  const ext = extname(filename).toLowerCase();
  if (ext === ".mp3") return "MP3";
  if (ext === ".wav" || ext === ".aiff" || ext === ".aif") return "WAVE";
  if (ext === ".flac") return "FLAC";
  if (ext === ".ogg") return "VORBIS";
  return "WAVE";
}

/**
 * Fractional media duration in seconds (ffprobe). Null on failure.
 * Prefer this over manifest endMs-startMs: soundboard hits store session end
 * as endMs, which would stretch a one-shot across the whole timeline.
 */
async function probeMediaDurationSec(
  absPath: string,
  allowedBaseDir: string,
): Promise<number | null> {
  try {
    const resolved = assertPathUnder(absPath, allowedBaseDir);
    const { stdout } = await exec(
      FFPROBE_PATH,
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        resolved,
      ],
      { maxBuffer: 64 * 1024 },
    );
    const d = parseFloat(stdout.trim());
    if (!Number.isFinite(d) || d <= 0) return null;
    return d;
  } catch {
    return null;
  }
}

function rationalTime(seconds: number): {
  OTIO_SCHEMA: string;
  rate: number;
  value: number;
} {
  return {
    OTIO_SCHEMA: "RationalTime.1",
    rate: OTIO_RATE,
    value: Math.max(0, seconds) * OTIO_RATE,
  };
}

function timeRange(
  startSec: number,
  durationSec: number,
): {
  OTIO_SCHEMA: string;
  start_time: ReturnType<typeof rationalTime>;
  duration: ReturnType<typeof rationalTime>;
} {
  return {
    OTIO_SCHEMA: "TimeRange.1",
    start_time: rationalTime(startSec),
    duration: rationalTime(durationSec),
  };
}

export function parseDawMarkers(raw: unknown): DawMarker[] {
  if (!Array.isArray(raw)) return [];
  const out: DawMarker[] = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") continue;
    const o = m as Record<string, unknown>;
    if (typeof o.time !== "number" || !Number.isFinite(o.time)) continue;
    out.push({
      time: o.time,
      title: typeof o.title === "string" ? o.title : undefined,
      markerType:
        o.markerType === "chapter" || o.markerType === "soundbite"
          ? o.markerType
          : o.markerType === ""
            ? ""
            : undefined,
      duration: typeof o.duration === "number" ? o.duration : undefined,
      color: typeof o.color === "string" ? o.color : undefined,
    });
  }
  return out;
}

function parseHexRgb(
  hex: string,
): { r: number; g: number; b: number } | null {
  const s = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
  return {
    r: parseInt(s.slice(0, 2), 16),
    g: parseInt(s.slice(2, 4), 16),
    b: parseInt(s.slice(4, 6), 16),
  };
}

/** Map HarborFM UI marker hex to nearest OTIO/Resolve marker color name. */
export function uiMarkerColorToOtio(color: string | undefined): string {
  const key = (color ?? UI_MARKER_COLORS[0]).trim().toLowerCase();
  const normalized = key.startsWith("#") ? key : `#${key}`;
  const direct = UI_HEX_TO_OTIO_COLOR[normalized];
  if (direct) return direct;

  const rgb = parseHexRgb(normalized);
  if (!rgb) return "BLUE";
  let best = "BLUE";
  let bestDist = Infinity;
  for (const uiHex of UI_MARKER_COLORS) {
    const otio = UI_HEX_TO_OTIO_COLOR[uiHex];
    if (!otio) continue;
    const c = parseHexRgb(uiHex);
    if (!c) continue;
    const dist =
      (rgb.r - c.r) ** 2 + (rgb.g - c.g) ** 2 + (rgb.b - c.b) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      best = otio;
    }
  }
  return best;
}

function parseTrimRanges(raw: unknown): Array<[number, number]> {
  if (!Array.isArray(raw)) return [];
  const out: Array<[number, number]> = [];
  for (const r of raw) {
    if (
      Array.isArray(r) &&
      r.length === 2 &&
      typeof r[0] === "number" &&
      typeof r[1] === "number" &&
      r[0] < r[1]
    ) {
      out.push([r[0], r[1]]);
    }
  }
  return out;
}

function markerLabelText(m: DawMarker): string {
  if (m.title?.trim()) return m.title.trim();
  if (m.markerType === "chapter") return "Chapter";
  if (m.markerType === "soundbite") return "Soundbite";
  return "Marker";
}

function readNonNegNumber(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/** Audacity labels.txt content, or null if nothing to write. */
export function buildAudacityLabelsText(
  markersRaw: unknown,
  trimRangesRaw: unknown,
  clips?: SegmentTrackClip[],
): string | null {
  const markers = parseDawMarkers(markersRaw);
  const trims = parseTrimRanges(trimRangesRaw);
  type Row = { start: number; end: number; text: string };
  const rows: Row[] = [];

  for (const m of markers) {
    if (m.markerType === "soundbite" && typeof m.duration === "number") {
      rows.push({
        start: m.time,
        end: m.time + m.duration,
        text: markerLabelText(m),
      });
    } else {
      rows.push({ start: m.time, end: m.time, text: markerLabelText(m) });
    }
  }
  for (const [start, end] of trims) {
    rows.push({ start, end, text: "Trim" });
  }
  // Track placement from startMs (same values as LOF offset / RPP POSITION).
  for (const clip of clips ?? []) {
    if (clip.startSec <= 0) continue;
    rows.push({
      start: clip.startSec,
      end: clip.startSec,
      text: `Track start: ${clip.name}`,
    });
  }
  if (rows.length === 0) return null;
  rows.sort((a, b) => a.start - b.start || a.end - b.end);
  return rows
    .map(
      (r) =>
        `${r.start.toFixed(6)}\t${r.end.toFixed(6)}\t${r.text.replace(/\t/g, " ")}`,
    )
    .join("\n") + "\n";
}

/**
 * Audacity LOF for one project window (next to segment.rpp / timeline.otio).
 * Paths are relative to the segment folder (e.g. recordings/foo.mp3).
 * Near-empty stubs are already omitted from clips (under 2KB).
 */
export function buildAudacityLof(clips: SegmentTrackClip[]): string | null {
  if (clips.length === 0) return null;
  const fileLines = clips.map((c) => {
    const path = c.mediaPath.replace(/\\/g, "/").replace(/"/g, "");
    return `file "${path}" offset ${fmtRppSec(Math.max(0, c.startSec))}`;
  });
  // One project window; all files as tracks.
  return ["window", ...fileLines].join("\n") + "\n";
}

async function resolveClipDurationSec(
  absPath: string,
  segDir: string,
  startMs: number,
  endMs: number | null,
  fallbackDurationSec: number,
): Promise<number> {
  const probed = await probeMediaDurationSec(absPath, segDir);
  if (probed != null && probed > 0) return probed;
  if (endMs != null && endMs > startMs) return (endMs - startMs) / 1000;
  return Math.max(0, fallbackDurationSec);
}

type ManifestSegEntry = {
  filePath?: string;
  startMs?: number | string;
  endMs?: number | string;
  segmentId?: string;
  participantId?: string | null;
  participantName?: string | null;
  source?: string | null;
  soundboardAssetId?: string | null;
};

/**
 * Build clip list from tracks_manifest (with startMs) when present,
 * else recording files, else mix audio.*.
 * Skips missing files and media under {@link MIN_DAW_MEDIA_BYTES}.
 */
export async function buildSegmentTrackClips(
  segDir: string,
  audioFile: string | null,
  fallbackDurationSec: number,
): Promise<SegmentTrackClip[]> {
  const recDir = join(segDir, "recordings");
  const manifestPath = join(recDir, "tracks_manifest.json");
  const clips: SegmentTrackClip[] = [];
  const seen = new Set<string>();

  if (existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
        segments?: ManifestSegEntry[];
      };
      const entries = Array.isArray(manifest.segments) ? manifest.segments : [];
      for (const entry of entries) {
        const rel =
          typeof entry.filePath === "string" ? entry.filePath : null;
        const trackBase = rel ? basename(rel.replace(/\\/g, "/")) : null;
        if (!trackBase || !isAudioFilename(trackBase)) continue;
        const mediaPath = `recordings/${trackBase}`;
        const abs = join(segDir, mediaPath);
        if (!isUsableDawMedia(abs)) continue;
        if (seen.has(mediaPath)) continue;
        seen.add(mediaPath);

        const startMs = readNonNegNumber(entry.startMs) ?? 0;
        const endMs = readNonNegNumber(entry.endMs);
        const durationSec = await resolveClipDurationSec(
          abs,
          segDir,
          startMs,
          endMs,
          fallbackDurationSec,
        );
        const name =
          (typeof entry.segmentId === "string" && entry.segmentId.trim()) ||
          trackBase.replace(/\.[^.]+$/, "") ||
          trackBase;
        clips.push({
          name,
          mediaPath,
          durationSec: Math.max(0, durationSec),
          startSec: startMs / 1000,
          participantId:
            typeof entry.participantId === "string"
              ? entry.participantId
              : null,
          participantName:
            typeof entry.participantName === "string"
              ? entry.participantName
              : null,
          source: typeof entry.source === "string" ? entry.source : null,
          soundboardAssetId:
            typeof entry.soundboardAssetId === "string"
              ? entry.soundboardAssetId
              : null,
        });
      }
    } catch {
      // fall through to directory listing
    }
  }

  if (clips.length === 0) {
    for (const rel of listRecordingRelPaths(segDir)) {
      const abs = join(segDir, rel);
      if (!isUsableDawMedia(abs)) continue;
      const durationSec = await resolveClipDurationSec(
        abs,
        segDir,
        0,
        null,
        fallbackDurationSec,
      );
      clips.push({
        name: basename(rel).replace(/\.[^.]+$/, "") || rel,
        mediaPath: rel,
        durationSec: Math.max(0, durationSec),
        startSec: 0,
      });
    }
  }

  if (clips.length === 0 && audioFile) {
    const abs = join(segDir, audioFile);
    if (isUsableDawMedia(abs)) {
      const durationSec = await resolveClipDurationSec(
        abs,
        segDir,
        0,
        null,
        fallbackDurationSec,
      );
      clips.push({
        name: audioFile.replace(/\.[^.]+$/, "") || "audio",
        mediaPath: audioFile,
        durationSec: Math.max(0, durationSec),
        startSec: 0,
      });
    }
  }

  return clips;
}

function laneGroupKey(clip: SegmentTrackClip): {
  kind: DawLane["kind"];
  key: string;
} {
  if (clip.source === "soundboard") {
    const asset =
      (clip.soundboardAssetId && clip.soundboardAssetId.trim()) ||
      clip.name ||
      "soundboard";
    return { kind: "soundboard", key: `sb:${asset}` };
  }
  const pid =
    (clip.participantId && String(clip.participantId).trim()) ||
    (clip.participantName && clip.participantName.trim()) ||
    "";
  if (pid) return { kind: "participant", key: `p:${pid}` };
  return { kind: "other", key: `o:${clip.mediaPath}` };
}

function laneDisplayBase(clip: SegmentTrackClip, kind: DawLane["kind"]): string {
  if (kind === "soundboard") {
    const asset =
      (clip.soundboardAssetId && clip.soundboardAssetId.trim()) || "soundboard";
    return `soundboard_${sanitizeTrackLabel(asset)}`;
  }
  if (kind === "participant") {
    const raw =
      (clip.participantName && clip.participantName.trim()) ||
      (clip.participantId && String(clip.participantId).trim()) ||
      "participant";
    return sanitizeTrackLabel(raw);
  }
  return sanitizeTrackLabel(clip.name || "track");
}

/**
 * Group clips into lanes for Reaper/Resolve: same participant (or same
 * soundboard asset) on one track. Participants first (by earliest start),
 * then soundboard / other. Participant lanes named Name_0, Name_1, …
 */
export function buildDawLanes(clips: SegmentTrackClip[]): DawLane[] {
  const groups = new Map<
    string,
    { kind: DawLane["kind"]; clips: SegmentTrackClip[]; base: string }
  >();

  for (const clip of clips) {
    const { kind, key } = laneGroupKey(clip);
    let g = groups.get(key);
    if (!g) {
      g = { kind, clips: [], base: laneDisplayBase(clip, kind) };
      groups.set(key, g);
    }
    g.clips.push(clip);
  }

  for (const g of groups.values()) {
    g.clips.sort((a, b) => a.startSec - b.startSec || a.name.localeCompare(b.name));
  }

  const earliest = (g: { clips: SegmentTrackClip[] }) =>
    g.clips[0]?.startSec ?? 0;

  const kindRank = (k: DawLane["kind"]) =>
    k === "participant" ? 0 : k === "other" ? 1 : 2;

  const ordered = [...groups.values()].sort((a, b) => {
    const kr = kindRank(a.kind) - kindRank(b.kind);
    if (kr !== 0) return kr;
    return earliest(a) - earliest(b) || a.base.localeCompare(b.base);
  });

  let participantIdx = 0;
  return ordered.map((g) => {
    let name: string;
    if (g.kind === "participant") {
      name = `${g.base}_${participantIdx}`;
      participantIdx += 1;
    } else if (g.kind === "soundboard") {
      name = g.base.startsWith("soundboard_")
        ? g.base
        : `soundboard_${sanitizeTrackLabel(g.base)}`;
    } else {
      name = g.base;
    }
    return { name, kind: g.kind, clips: g.clips };
  });
}

/** Flat clip list in lane order (Audacity LOF: one file per track). */
export function flattenDawLanes(lanes: DawLane[]): SegmentTrackClip[] {
  return lanes.flatMap((lane) =>
    lane.clips.map((c) => ({
      ...c,
      name: lane.name,
    })),
  );
}

function buildRppItem(clip: SegmentTrackClip): string {
  const fileName = basename(clip.mediaPath);
  const source = reaperSourceTag(fileName);
  return `    <ITEM
      POSITION ${fmtRppSec(clip.startSec)}
      SNAPOFFS 0
      LENGTH ${fmtRppSec(clip.durationSec)}
      LOOP 0
      ALLTAKES 0
      MUTE 0
      SEL 0
      NAME "${escapeRppString(fileName)}"
      VOLPAN 1 0 1 -1
      SOFFS 0
      PLAYRATE 1 1 0 -1 0 0.0025
      CHANMODE 0
      <SOURCE ${source}
        FILE "${escapeRppString(clip.mediaPath)}"
      >
    >`;
}

/**
 * REAPER native color: 0x01BBGGRR (custom flag + BGR).
 * Matches UI marker hex when possible.
 */
function uiHexToReaperColor(color: string | undefined): number {
  const key = (color ?? UI_MARKER_COLORS[0]).trim().toLowerCase();
  const normalized = key.startsWith("#") ? key : `#${key}`;
  const rgb = parseHexRgb(normalized);
  if (!rgb) {
    const fallback = parseHexRgb(UI_MARKER_COLORS[0]);
    if (!fallback) return 0;
    return (
      0x01000000 | (fallback.b << 16) | (fallback.g << 8) | fallback.r
    );
  }
  return 0x01000000 | (rgb.b << 16) | (rgb.g << 8) | rgb.r;
}

/**
 * Project-level MARKER lines. Soundbites with duration become regions
 * (start + end lines sharing an id).
 */
export function buildRppMarkerLines(markers: DawMarker[]): string[] {
  if (markers.length === 0) return [];
  const sorted = [...markers].sort((a, b) => a.time - b.time);
  const lines: string[] = [];
  let id = 1;
  for (const m of sorted) {
    const name = escapeRppString(markerLabelText(m));
    const color = uiHexToReaperColor(m.color);
    const pos = fmtRppSec(Math.max(0, m.time));
    const dur =
      typeof m.duration === "number" && Number.isFinite(m.duration)
        ? m.duration
        : 0;
    const isRegion = m.markerType === "soundbite" && dur > 0;
    if (isRegion) {
      const end = fmtRppSec(Math.max(0, m.time + dur));
      // Region: same id on start/end lines (flags 1 = isrgn).
      lines.push(`  MARKER ${id} ${pos} "${name}" 1 ${color} 1`);
      lines.push(`  MARKER ${id} ${end} "" 1`);
    } else {
      lines.push(`  MARKER ${id} ${pos} "${name}" 0 ${color} 1`);
    }
    id += 1;
  }
  return lines;
}

/**
 * segment.rpp: one TRACK per participant/soundboard lane; multiple ITEMs when
 * a participant reconnects. LOOP 0 so one-shots play once. NCHAN 1 = mono.
 */
export function buildSegmentRppText(
  lanes: DawLane[],
  markers?: DawMarker[],
): string | null {
  if (lanes.length === 0) return null;
  const tracks = lanes.map((lane) => {
    const items = lane.clips.map(buildRppItem).join("\n");
    return `  <TRACK
    NAME "${escapeRppString(lane.name)}"
    NCHAN 1
${items}
  >`;
  });
  const markerLines = buildRppMarkerLines(markers ?? []);
  const markerBlock =
    markerLines.length > 0 ? `${markerLines.join("\n")}\n` : "";
  return `<REAPER_PROJECT 0.1 "${escapeRppString(APP_NAME)}" 0
${markerBlock}${tracks.join("\n")}
>
`;
}

function otioMarkers(markers: DawMarker[] | undefined): unknown[] {
  if (!markers?.length) return [];
  return markers.map((m) => {
    const end =
      m.markerType === "soundbite" && typeof m.duration === "number"
        ? m.time + m.duration
        : m.time;
    const resolveColor = uiMarkerColorToOtio(m.color);
    return {
      OTIO_SCHEMA: "Marker.2",
      name: markerLabelText(m),
      marked_range: timeRange(m.time, Math.max(0, end - m.time) || 0),
      color: resolveColor,
      metadata: {
        Resolve_OTIO: { Color: resolveColor },
        harborfm: {
          markerType: m.markerType ?? "",
          uiColor: m.color ?? UI_MARKER_COLORS[0],
        },
      },
      comment: null,
    };
  });
}

function otioGap(durationSec: number): unknown {
  return {
    OTIO_SCHEMA: "Gap.1",
    name: "Gap",
    source_range: timeRange(0, durationSec),
    effects: [],
    markers: [],
    metadata: {},
    enabled: true,
  };
}

/**
 * Resolve Clip Attributes-shaped audio mapping (same JSON as GetAudioMapping).
 * Stereo clip with Embedded Channel 1 > Left and Embedded Channel 1 > Right
 * so mono sources play in both ears without remuxing.
 */
function resolveAudioMappingDualMono(): Record<string, unknown> {
  return {
    embedded_audio_channels: 1,
    linked_audio: {},
    track_mapping: {
      "1": {
        channel_idx: [1, 1],
        mute: false,
        type: "Stereo",
      },
    },
  };
}

function resolveStereoDualMonoMetadata(): Record<string, unknown> {
  const mapping = resolveAudioMappingDualMono();
  return {
    Resolve_OTIO: {
      "Track Type": "Stereo",
      "Audio Type": "Stereo",
      "Audio Mapping": mapping,
    },
    Resolve: {
      "Track Type": "Stereo",
      "Audio Track Format": "Stereo",
      "Audio Mapping": mapping,
    },
    // Some Resolve builds read the mapping at this key directly.
    AudioMapping: mapping,
    harborfm: {
      channels: 1,
      resolveChannelMap: "stereo_dual_mono_ch1",
    },
  };
}

function otioClip(clip: SegmentTrackClip): unknown {
  const dur = Math.max(0, clip.durationSec);
  const audioMeta = resolveStereoDualMonoMetadata();
  return {
    OTIO_SCHEMA: "Clip.1",
    name: clip.name,
    source_range: timeRange(0, dur),
    effects: [],
    markers: [],
    metadata: audioMeta,
    media_reference: {
      OTIO_SCHEMA: "ExternalReference.1",
      name: basename(clip.mediaPath),
      // Relative to the .otio file (segment folder). Resolve resolves by
      // basename against the timeline's directory / search paths.
      target_url: clip.mediaPath.replace(/\\/g, "/"),
      available_range: timeRange(0, dur),
      metadata: audioMeta,
    },
  };
}

/** OTIO track children: Gaps between clips so reconnects sit on one lane. */
function otioLaneChildren(clips: SegmentTrackClip[]): unknown[] {
  const sorted = [...clips].sort((a, b) => a.startSec - b.startSec);
  const children: unknown[] = [];
  let cursor = 0;
  for (const clip of sorted) {
    const gap = clip.startSec - cursor;
    if (gap > 0.0005) children.push(otioGap(gap));
    children.push(otioClip(clip));
    cursor = Math.max(cursor, clip.startSec + Math.max(0, clip.durationSec));
  }
  return children;
}

/**
 * Segment OTIO: one audio Track per lane (participant / soundboard), named
 * Logan_0 / soundboard_<assetId>. Markers live on the timeline Stack (not clips).
 */
export function buildSegmentOtioTimeline(
  timelineName: string,
  lanes: DawLane[],
  markers?: DawMarker[],
): object {
  const trackChildren = lanes.map((lane) => ({
    OTIO_SCHEMA: "Track.1",
    name: lane.name,
    kind: "Audio",
    children: otioLaneChildren(lane.clips),
    effects: [],
    markers: [],
    metadata: resolveStereoDualMonoMetadata(),
    source_range: null,
    enabled: true,
  }));

  return {
    OTIO_SCHEMA: "Timeline.1",
    name: timelineName,
    global_start_time: null,
    metadata: { harborfm: { app: APP_NAME } },
    tracks: {
      OTIO_SCHEMA: "Stack.1",
      name: "tracks",
      children: trackChildren,
      effects: [],
      // Timeline-level markers (Resolve ruler), not per-clip.
      markers: otioMarkers(markers),
      metadata: {},
      source_range: null,
      enabled: true,
    },
  };
}

/**
 * Write audacity.lof, labels.txt, segment.rpp, and timeline.otio into segDir.
 */
export async function writeSegmentDawSidecars(
  segDir: string,
  opts: {
    audioFile: string | null;
    durationSec: number;
    markers: unknown;
    trimRanges: unknown;
    timelineName?: string;
  },
): Promise<void> {
  const clips = await buildSegmentTrackClips(
    segDir,
    opts.audioFile,
    opts.durationSec,
  );
  const lanes = buildDawLanes(clips);
  const flat = flattenDawLanes(lanes);
  const markers = parseDawMarkers(opts.markers);

  // Audacity: one file per clip (cannot merge onto one track via LOF).
  // Same folder as segment.rpp / timeline.otio; paths like recordings/….
  const lof = buildAudacityLof(flat);
  if (lof) writeFileSync(join(segDir, "audacity.lof"), lof, "utf8");

  const labels = buildAudacityLabelsText(
    opts.markers,
    opts.trimRanges,
    flat,
  );
  if (labels) writeFileSync(join(segDir, "labels.txt"), labels, "utf8");

  const rpp = buildSegmentRppText(lanes, markers);
  if (rpp) writeFileSync(join(segDir, "segment.rpp"), rpp, "utf8");

  if (lanes.length > 0) {
    const timeline = buildSegmentOtioTimeline(
      opts.timelineName?.trim() || "Segment",
      lanes,
      markers,
    );
    writeFileSync(
      join(segDir, "timeline.otio"),
      JSON.stringify(timeline, null, 2) + "\n",
      "utf8",
    );
  }
}
