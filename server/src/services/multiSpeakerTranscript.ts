/**
 * Multi-speaker (per-track) transcript generation for multitrack segments.
 * ASR each included take, map cues onto the segment timeline, label speakers,
 * merge + sort into one SRT.
 */
import { basename, join } from "path";
import { existsSync, statSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { eq, inArray } from "drizzle-orm";
import {
  castTranscriptLabel,
  resolveIncludeInTranscript,
  type SegmentTrackClip,
} from "@harborfm/shared";
import { drizzleDb } from "../db/index.js";
import { podcastCast } from "../db/schema.js";
import { findMultitrackDir } from "../modules/episodes/projectSegmentPack.js";
import { readTracksManifestFile } from "../modules/episodes/projectSegmentShared.js";
import type { MultitrackSegmentEntry } from "./multitrackRemake.js";
import * as audioService from "./audio.js";
import {
  formatSrtEntries,
  formatSrtTime,
  mergeTrimRanges,
  parseSrtTime,
  runTranscription,
  runTranscriptionToEntries,
  toEffectiveTime,
  type SrtEntry,
} from "../modules/segments/utils.js";

export type MultiSpeakerSettings = Parameters<typeof runTranscription>[2];

function clipStartMs(c: MultitrackSegmentEntry): number {
  const raw =
    typeof c.startMs === "number" && Number.isFinite(c.startMs) ? c.startMs : 0;
  return Math.max(0, raw);
}

function clipLengthMs(c: MultitrackSegmentEntry): number {
  if (typeof c.lengthMs === "number" && c.lengthMs > 0) return c.lengthMs;
  const start = clipStartMs(c);
  if (typeof c.endMs === "number" && c.endMs > start) return c.endMs - start;
  return 0;
}

function sourceOffsetMsOf(c: MultitrackSegmentEntry): number {
  return typeof c.sourceOffsetMs === "number" && c.sourceOffsetMs > 0
    ? c.sourceOffsetMs
    : 0;
}

function takeBasename(filePath: string | undefined): string {
  return basename(String(filePath ?? "").replace(/\\/g, "/")) || "unknown";
}

function speakerKey(clip: MultitrackSegmentEntry): string {
  const castId =
    typeof clip.castId === "string" && clip.castId.trim()
      ? clip.castId.trim()
      : "";
  if (castId) return `cast:${castId}`;
  const pid =
    typeof clip.participantId === "string" && clip.participantId.trim()
      ? clip.participantId.trim()
      : "";
  if (pid) return `pid:${pid}`;
  const name =
    typeof clip.participantName === "string" && clip.participantName.trim()
      ? clip.participantName.trim().toLowerCase()
      : "";
  if (name) return `name:${name}`;
  return `file:${takeBasename(clip.filePath)}`;
}

function asClipLike(c: MultitrackSegmentEntry): SegmentTrackClip {
  return c as unknown as SegmentTrackClip;
}

/** Clips included for multi-track Whisper (resolved defaults). */
export function includedTranscriptClips(
  clips: MultitrackSegmentEntry[],
): MultitrackSegmentEntry[] {
  return clips.filter((c) => resolveIncludeInTranscript(asClipLike(c)));
}

/** Unique speaker keys among included clips. */
export function countIncludedSpeakers(
  clips: MultitrackSegmentEntry[],
): number {
  const keys = new Set(includedTranscriptClips(clips).map(speakerKey));
  return keys.size;
}

export function canUseMultiTrackWhisper(opts: {
  multiTrackWhisperEnabled: boolean;
  mtDir: string | null;
  clips: MultitrackSegmentEntry[];
}): boolean {
  if (!opts.multiTrackWhisperEnabled) return false;
  if (!opts.mtDir) return false;
  return countIncludedSpeakers(opts.clips) >= 2;
}

function loadCastLabels(
  podcastId: string,
  castIds: string[],
): Map<string, string> {
  const map = new Map<string, string>();
  if (castIds.length === 0) return map;
  const rows = drizzleDb
    .select({
      id: podcastCast.id,
      name: podcastCast.name,
      nickname: podcastCast.nickname,
      podcastId: podcastCast.podcastId,
    })
    .from(podcastCast)
    .where(inArray(podcastCast.id, castIds))
    .all();
  for (const row of rows) {
    if (row.podcastId !== podcastId) continue;
    map.set(
      row.id,
      castTranscriptLabel({
        name: row.name,
        nickname: row.nickname,
      }),
    );
  }
  return map;
}

function speakerLabelForClip(
  clip: MultitrackSegmentEntry,
  castLabels: Map<string, string>,
): string {
  const castId =
    typeof clip.castId === "string" && clip.castId.trim()
      ? clip.castId.trim()
      : "";
  if (castId && castLabels.has(castId)) return castLabels.get(castId)!;
  const name =
    typeof clip.participantName === "string" && clip.participantName.trim()
      ? clip.participantName.trim()
      : "";
  return name || "Speaker";
}

function prefixCueText(label: string, text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return `${label}:`;
  // Avoid double-prefix if ASR already echoed a label somehow.
  const re = new RegExp(`^${escapeRegExp(label)}\\s*:\\s*`, "i");
  if (re.test(trimmed)) return trimmed;
  return `${label}: ${trimmed}`;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Drop / remap cues so soft-trim exclusion ranges are removed from the
 * playable timeline (same idea as render).
 */
export function applySoftTrimsToSrtEntries(
  entries: SrtEntry[],
  trimRanges: Array<[number, number]>,
  durationSec: number,
): SrtEntry[] {
  const merged = mergeTrimRanges(trimRanges, durationSec);
  if (merged.length === 0) return entries;
  const out: SrtEntry[] = [];
  for (const entry of entries) {
    const startSec = parseSrtTime(entry.start);
    const endSec = parseSrtTime(entry.end);
    if (endSec <= startSec) continue;
    // Fully inside a trim: drop.
    const fullyTrimmed = merged.some(
      ([ts, te]) => startSec >= ts && endSec <= te,
    );
    if (fullyTrimmed) continue;
    const es = toEffectiveTime(startSec, merged);
    const ee = toEffectiveTime(endSec, merged);
    if (ee <= es) continue;
    out.push({
      ...entry,
      start: formatSrtTime(es),
      end: formatSrtTime(ee),
    });
  }
  return out;
}

/**
 * Map ASR cues from an extract that starts at extractSourceStartSec (extract t=0)
 * onto the segment timeline at clip.startMs.
 */
function mapExtractCuesToClipTimeline(
  extractEntries: SrtEntry[],
  clip: MultitrackSegmentEntry,
  label: string,
  extractSourceStartSec: number,
  extractSourceEndSec: number,
): SrtEntry[] {
  const srcOffSec = sourceOffsetMsOf(clip) / 1000;
  const startSec = clipStartMs(clip) / 1000;
  const playRate = playRateOf(clip);
  const lenSec = clipLengthMs(clip) / 1000;
  const clipSrcEnd =
    lenSec > 0 ? srcOffSec + lenSec * playRate : extractSourceEndSec;
  const out: SrtEntry[] = [];
  for (const entry of extractEntries) {
    const takeStart = extractSourceStartSec + parseSrtTime(entry.start);
    const takeEnd = extractSourceStartSec + parseSrtTime(entry.end);
    const lo = Math.max(takeStart, srcOffSec, extractSourceStartSec);
    const hi = Math.min(takeEnd, clipSrcEnd, extractSourceEndSec);
    if (hi <= lo) continue;
    const timelineStart = startSec + (lo - srcOffSec) / playRate;
    const timelineEnd = startSec + (hi - srcOffSec) / playRate;
    if (timelineEnd <= timelineStart) continue;
    out.push({
      index: 0,
      start: formatSrtTime(timelineStart),
      end: formatSrtTime(timelineEnd),
      text: prefixCueText(label, entry.text),
    });
  }
  return out;
}

function playRateOf(clip: MultitrackSegmentEntry): number {
  return typeof clip.playRate === "number" &&
    Number.isFinite(clip.playRate) &&
    clip.playRate > 0
    ? clip.playRate
    : 1;
}

/** Source-media window [startSec, endSec) for a clip (take-local). */
function clipSourceWindowSec(
  clip: MultitrackSegmentEntry,
  takeDurationSec: number,
): { startSec: number; endSec: number } | null {
  const srcOffSec = sourceOffsetMsOf(clip) / 1000;
  const lenSec = clipLengthMs(clip) / 1000;
  const playRate = playRateOf(clip);
  const sourceWindowSec =
    lenSec > 0
      ? lenSec * playRate
      : Math.max(0, takeDurationSec - srcOffSec);
  if (sourceWindowSec <= 0) return null;
  const endSec = Math.min(takeDurationSec, srcOffSec + sourceWindowSec);
  if (endSec <= srcOffSec) return null;
  return { startSec: srcOffSec, endSec };
}

/** Cap ASR extract length so Whisper uploads stay reliable. */
const MAX_ASR_EXTRACT_SEC = 8 * 60;

/** Split a source window into <= MAX_ASR_EXTRACT_SEC pieces. */
function splitSourceWindow(
  startSec: number,
  endSec: number,
): Array<{ startSec: number; endSec: number }> {
  const out: Array<{ startSec: number; endSec: number }> = [];
  let cursor = startSec;
  while (cursor < endSec - 0.05) {
    const next = Math.min(endSec, cursor + MAX_ASR_EXTRACT_SEC);
    out.push({ startSec: cursor, endSec: next });
    cursor = next;
  }
  return out;
}

/**
 * Extract a take window and run ASR. Uses fast input seeking (keyframe-accurate
 * enough for short windows) instead of decoding from file start.
 */
async function asrTakeWindow(opts: {
  takeAbs: string;
  mtDir: string;
  takeDurationSec: number;
  startSec: number;
  endSec: number;
  settings: MultiSpeakerSettings;
}): Promise<SrtEntry[]> {
  const durationSec = opts.endSec - opts.startSec;
  if (durationSec < 0.05) return [];
  let chunkPath: string | null = null;
  try {
    const coversFromStart =
      opts.startSec <= 0.05 && opts.endSec >= opts.takeDurationSec - 0.05;
    const audioPath = coversFromStart
      ? opts.takeAbs
      : await audioService.extractAudioChunkToTmp(
          opts.takeAbs,
          opts.mtDir,
          opts.startSec,
          durationSec,
          // Fast input seek: one keyframe slip beats decoding 20+ minutes.
          { accurateSeek: false },
        );
    if (!coversFromStart) chunkPath = audioPath;
    if (!existsSync(audioPath) || statSync(audioPath).size < 1024) {
      throw new Error(
        `Transcript extract was empty (${opts.startSec.toFixed(1)}s-${opts.endSec.toFixed(1)}s)`,
      );
    }
    // Word timestamps tighten cue starts (Whisper segment starts often include
    // leading silence, which makes mix playback hear the wrong speaker).
    return runTranscriptionToEntries(
      audioPath,
      coversFromStart ? opts.mtDir : tmpdir(),
      opts.settings as never,
    );
  } finally {
    if (chunkPath) {
      try {
        unlinkSync(chunkPath);
      } catch {
        // ignore
      }
    }
  }
}

/**
 * ASR clip source windows (split if long), map onto the segment timeline.
 * Failed windows are skipped so one bad extract does not wipe speaker labels.
 */
async function transcribeClipsOnTake(opts: {
  takeAbs: string;
  mtDir: string;
  clips: MultitrackSegmentEntry[];
  castLabels: Map<string, string>;
  settings: MultiSpeakerSettings;
}): Promise<SrtEntry[]> {
  let takeDurationSec = 0;
  try {
    takeDurationSec = await audioService.probeAudioDurationFloat(
      opts.takeAbs,
      opts.mtDir,
    );
  } catch (err) {
    console.error(
      `[transcript] Skipping take (probe failed): ${basename(opts.takeAbs)}`,
      err,
    );
    return [];
  }
  if (takeDurationSec < 0.25 || statSync(opts.takeAbs).size < 1024) {
    return [];
  }

  const merged: SrtEntry[] = [];
  // Dedupe identical source windows so mute-split clones do not re-ASR.
  const asrCache = new Map<string, SrtEntry[] | "failed">();

  for (const clip of opts.clips) {
    const window = clipSourceWindowSec(clip, takeDurationSec);
    if (!window) continue;
    if (window.startSec >= takeDurationSec - 0.05) continue;
    const label = speakerLabelForClip(clip, opts.castLabels);
    const pieces = splitSourceWindow(
      window.startSec,
      Math.min(window.endSec, takeDurationSec),
    );
    for (const piece of pieces) {
      const cacheKey = `${piece.startSec.toFixed(3)}:${piece.endSec.toFixed(3)}`;
      let cached = asrCache.get(cacheKey);
      if (cached === "failed") continue;
      if (!cached) {
        try {
          cached = await asrTakeWindow({
            takeAbs: opts.takeAbs,
            mtDir: opts.mtDir,
            takeDurationSec,
            startSec: piece.startSec,
            endSec: piece.endSec,
            settings: opts.settings,
          });
          asrCache.set(cacheKey, cached);
        } catch (err) {
          console.error(
            `[transcript] ASR window failed ${basename(opts.takeAbs)} ` +
              `${piece.startSec.toFixed(1)}-${piece.endSec.toFixed(1)}s`,
            err,
          );
          asrCache.set(cacheKey, "failed");
          continue;
        }
      }
      merged.push(
        ...mapExtractCuesToClipTimeline(
          cached,
          clip,
          label,
          piece.startSec,
          piece.endSec,
        ),
      );
    }
  }
  return merged;
}

/**
 * Build a multi-speaker SRT from included multitrack clips.
 * Returns null when multi-track path should not be used (caller falls back to mix).
 */
export async function generateMultiSpeakerSegmentSrt(opts: {
  podcastId: string;
  episodeId: string;
  segmentId: string;
  settings: MultiSpeakerSettings;
  multiTrackWhisperEnabled: boolean;
}): Promise<string | null> {
  const mtDir = findMultitrackDir(
    opts.podcastId,
    opts.episodeId,
    opts.segmentId,
  );
  const manifest = mtDir ? readTracksManifestFile(mtDir) : null;
  const clips = Array.isArray(manifest?.segments)
    ? (manifest!.segments as MultitrackSegmentEntry[])
    : [];

  if (
    !canUseMultiTrackWhisper({
      multiTrackWhisperEnabled: opts.multiTrackWhisperEnabled,
      mtDir,
      clips,
    })
  ) {
    return null;
  }

  const included = includedTranscriptClips(clips);
  const castIds = [
    ...new Set(
      included
        .map((c) =>
          typeof c.castId === "string" && c.castId.trim()
            ? c.castId.trim()
            : "",
        )
        .filter(Boolean),
    ),
  ];
  const castLabels = loadCastLabels(opts.podcastId, castIds);

  // Group clips by take; ASR each clip's source window (split if long).
  const byTake = new Map<string, MultitrackSegmentEntry[]>();
  for (const clip of included) {
    const file = takeBasename(clip.filePath);
    const list = byTake.get(file) ?? [];
    list.push(clip);
    byTake.set(file, list);
  }

  const merged: SrtEntry[] = [];
  for (const [file, takeClips] of byTake) {
    const abs = join(mtDir!, file);
    if (!existsSync(abs)) {
      console.error(`[transcript] Take media missing, skipping: ${file}`);
      continue;
    }
    try {
      merged.push(
        ...(await transcribeClipsOnTake({
          takeAbs: abs,
          mtDir: mtDir!,
          clips: takeClips,
          castLabels,
          settings: opts.settings,
        })),
      );
    } catch (err) {
      console.error(`[transcript] Take ASR failed, skipping: ${file}`, err);
    }
  }

  if (merged.length === 0) {
    // Signal caller to fall back to mix ASR.
    return null;
  }

  merged.sort(
    (a, b) =>
      parseSrtTime(a.start) - parseSrtTime(b.start) ||
      parseSrtTime(a.end) - parseSrtTime(b.end),
  );

  // Keep absolute mix-timeline times. SegmentTranscriptTab seeks the full
  // mix; soft-trim remapping belongs in episode stitch only.
  return formatSrtEntries(merged);
}

/**
 * True when the segment transcript sidecar is missing or older than mix /
 * tracks_manifest / included take files.
 */
export function isSegmentTranscriptStale(opts: {
  podcastId: string;
  episodeId: string;
  segmentId: string;
  transcriptPath: string;
  mixAudioPath: string | null;
  multiTrackWhisperEnabled: boolean;
}): boolean {
  if (!existsSync(opts.transcriptPath)) return true;
  let transcriptMtime = 0;
  try {
    transcriptMtime = statSync(opts.transcriptPath).mtimeMs;
  } catch {
    return true;
  }

  let newest = 0;
  if (opts.mixAudioPath && existsSync(opts.mixAudioPath)) {
    try {
      newest = Math.max(newest, statSync(opts.mixAudioPath).mtimeMs);
    } catch {
      // ignore
    }
  }

  const mtDir = findMultitrackDir(
    opts.podcastId,
    opts.episodeId,
    opts.segmentId,
  );
  if (mtDir) {
    const manifestPath = join(mtDir, "tracks_manifest.json");
    if (existsSync(manifestPath)) {
      try {
        newest = Math.max(newest, statSync(manifestPath).mtimeMs);
      } catch {
        // ignore
      }
    }
    const manifest = readTracksManifestFile(mtDir);
    const clips = Array.isArray(manifest?.segments)
      ? (manifest!.segments as MultitrackSegmentEntry[])
      : [];
    const included =
      opts.multiTrackWhisperEnabled !== false
        ? includedTranscriptClips(clips)
        : clips;
    for (const c of included) {
      const abs = join(mtDir, takeBasename(c.filePath));
      if (!existsSync(abs)) continue;
      try {
        newest = Math.max(newest, statSync(abs).mtimeMs);
      } catch {
        // ignore
      }
    }
  }

  return newest > transcriptMtime + 1;
}

/** Look up cast by id for a podcast (used in tests / helpers). */
export function getCastTranscriptLabelById(
  podcastId: string,
  castId: string,
): string | null {
  const row = drizzleDb
    .select({
      id: podcastCast.id,
      name: podcastCast.name,
      nickname: podcastCast.nickname,
      podcastId: podcastCast.podcastId,
    })
    .from(podcastCast)
    .where(eq(podcastCast.id, castId))
    .limit(1)
    .get();
  if (!row || row.podcastId !== podcastId) return null;
  return castTranscriptLabel(row);
}
