/**
 * Shared segment / episode transcript generation helpers (multi-track + stitch).
 */
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { dirname } from "path";
import type { MultiSpeakerSettings } from "./multiSpeakerTranscript.js";
import {
  applySoftTrimsToSrtEntries,
  generateMultiSpeakerSegmentSrt,
  isSegmentTranscriptStale,
} from "./multiSpeakerTranscript.js";
import {
  formatSrtEntries,
  formatSrtTime,
  mergeTrimRanges,
  parseSrt,
  parseSrtTime,
  runTranscription,
  transcriptPath,
  type SrtEntry,
} from "../modules/segments/utils.js";
import * as repo from "../modules/segments/repo.js";
import { findMultitrackDir } from "../modules/episodes/projectSegmentPack.js";

function parseTrimRangesField(
  raw: unknown,
  durationSec: number,
): Array<[number, number]> {
  if (raw == null) return [];
  let parsed: unknown = raw;
  if (typeof raw === "string" && raw.trim()) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  const ranges: Array<[number, number]> = [];
  for (const item of parsed) {
    if (
      Array.isArray(item) &&
      item.length >= 2 &&
      typeof item[0] === "number" &&
      typeof item[1] === "number"
    ) {
      ranges.push([item[0], item[1]]);
    }
  }
  return mergeTrimRanges(ranges, durationSec);
}

export function effectiveSegmentDurationSec(
  durationSec: number,
  trimRanges: Array<[number, number]>,
): number {
  if (trimRanges.length === 0) return Math.max(0, durationSec);
  const trimmed = trimRanges.reduce((sum, [a, b]) => sum + (b - a), 0);
  return Math.max(0, durationSec - trimmed);
}

/**
 * Generate segment transcript (multi-track when eligible) and write sidecar.
 */
export async function generateSegmentTranscriptFile(opts: {
  podcastId: string;
  episodeId: string;
  segmentId: string;
  audioPath: string;
  audioBase: string;
  settings: MultiSpeakerSettings;
  multiTrackWhisperEnabled: boolean;
  trimRanges?: unknown;
  durationSec?: number;
}): Promise<void> {
  const txtPath = transcriptPath(opts.audioPath);
  mkdirSync(dirname(txtPath), { recursive: true });

  let multi: string | null = null;
  if (opts.multiTrackWhisperEnabled !== false) {
    try {
      multi = await generateMultiSpeakerSegmentSrt({
        podcastId: opts.podcastId,
        episodeId: opts.episodeId,
        segmentId: opts.segmentId,
        settings: opts.settings,
        multiTrackWhisperEnabled: true,
      });
    } catch (err) {
      console.error(
        "[transcript] Multi-track Whisper failed; falling back to mix ASR",
        err,
      );
      multi = null;
    }
  }
  if (multi && multi.trim()) {
    writeFileSync(txtPath, multi, "utf-8");
    return;
  }
  const text = await runTranscription(
    opts.audioPath,
    opts.audioBase,
    opts.settings,
  );
  writeFileSync(txtPath, text, "utf-8");
}

/**
 * True when episode transcript generation needs ASR (stale/missing segment SRT,
 * or no segment audio so the final mix must be transcribed).
 */
export function episodeTranscriptNeedsAsr(
  podcastId: string,
  episodeId: string,
): boolean {
  const segments = repo.listSegmentsForEpisode(episodeId);
  let anyAudio = false;
  for (const seg of segments) {
    if (seg.disabled) continue;
    const audio = repo.getSegmentAudioPath(
      seg as unknown as Record<string, unknown>,
      podcastId,
      episodeId,
    );
    if (!audio || !existsSync(audio.path)) continue;
    anyAudio = true;
    const txtPath = transcriptPath(audio.path);
    const mtEnabled = seg.multiTrackWhisperEnabled !== false;
    if (
      isSegmentTranscriptStale({
        podcastId,
        episodeId,
        segmentId: seg.id,
        transcriptPath: txtPath,
        mixAudioPath: audio.path,
        multiTrackWhisperEnabled: mtEnabled,
      })
    ) {
      return true;
    }
  }
  // No segment audio: caller falls back to mix ASR.
  return !anyAudio;
}

/**
 * Ensure each segment with audio has a fresh transcript, then stitch into one SRT.
 * Returns null when no segment audios are available (caller may fall back to mix ASR).
 */
export async function stitchEpisodeTranscriptFromSegments(opts: {
  podcastId: string;
  episodeId: string;
  settings: MultiSpeakerSettings;
  onProgress?: (message: string) => void;
}): Promise<string | null> {
  const segments = repo.listSegmentsForEpisode(opts.episodeId);
  const parts: Array<{ entries: SrtEntry[]; offsetSec: number; durationSec: number }> =
    [];
  let offsetSec = 0;
  let anyAudio = false;

  for (const seg of segments) {
    if (seg.disabled) continue;
    const audio = repo.getSegmentAudioPath(
      seg as unknown as Record<string, unknown>,
      opts.podcastId,
      opts.episodeId,
    );
    if (!audio || !existsSync(audio.path)) continue;
    anyAudio = true;

    const durationSec = Number(seg.durationSec) || 0;
    const trimRanges = parseTrimRangesField(seg.trimRanges, durationSec);
    const effective = effectiveSegmentDurationSec(durationSec, trimRanges);
    const txtPath = transcriptPath(audio.path);
    const mtEnabled = seg.multiTrackWhisperEnabled !== false;

    const stale = isSegmentTranscriptStale({
      podcastId: opts.podcastId,
      episodeId: opts.episodeId,
      segmentId: seg.id,
      transcriptPath: txtPath,
      mixAudioPath: audio.path,
      multiTrackWhisperEnabled: mtEnabled,
    });

    if (stale) {
      opts.onProgress?.(
        `Transcribing segment ${seg.name?.trim() || seg.id}...`,
      );
      // Avoid concurrent status conflict: episode job owns the work.
      await generateSegmentTranscriptFile({
        podcastId: opts.podcastId,
        episodeId: opts.episodeId,
        segmentId: seg.id,
        audioPath: audio.path,
        audioBase: audio.base,
        settings: opts.settings,
        multiTrackWhisperEnabled: mtEnabled,
        trimRanges: seg.trimRanges,
        durationSec,
      });
    }

    if (!existsSync(txtPath)) {
      throw new Error(
        `Segment transcript missing after generate: ${seg.name?.trim() || seg.id}`,
      );
    }
    // Segment SRTs stay on the mix timeline; remap soft trims only for the
    // final episode SRT (matches rendered audio after trims).
    const rawEntries = parseSrt(readFileSync(txtPath, "utf-8"));
    const entries = applySoftTrimsToSrtEntries(
      rawEntries,
      trimRanges,
      durationSec,
    );
    parts.push({ entries, offsetSec, durationSec: effective });
    offsetSec += effective;
  }

  if (!anyAudio) return null;

  const merged: SrtEntry[] = [];
  for (const part of parts) {
    for (const entry of part.entries) {
      const start = parseSrtTime(entry.start) + part.offsetSec;
      const end = parseSrtTime(entry.end) + part.offsetSec;
      if (end <= start) continue;
      merged.push({
        index: 0,
        start: formatSrtTime(start),
        end: formatSrtTime(end),
        text: entry.text,
      });
    }
  }
  return formatSrtEntries(merged);
}

/** True when this segment can attempt multi-track (has recordings folder). */
export function segmentHasMultitrackDir(
  podcastId: string,
  episodeId: string,
  segmentId: string,
): boolean {
  return Boolean(findMultitrackDir(podcastId, episodeId, segmentId));
}
