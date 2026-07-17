import { readFileSync, unlinkSync, existsSync, statSync } from "fs";
import { extname } from "path";
import { tmpdir } from "os";
import { Agent } from "undici";
import { readSettings } from "../settings/index.js";
import { assertPathUnder } from "../../services/paths.js";
import * as audioService from "../../services/audio.js";
import type { SilencePeriod } from "../../services/audio.js";
import { contentTypeFromAudioPath } from "../../utils/audio.js";
import {
  OPENAI_TRANSCRIPTION_DEFAULT_URL,
  TRANSCRIPTION_CHUNK_MAX_BYTES,
  TRANSCRIPTION_FETCH_TIMEOUT_MS,
  WAVEFORM_EXTENSION,
} from "../../config.js";

/** Shared dispatcher so Whisper/OpenAI can run longer than Node's default 5-minute headersTimeout. */
const transcriptionAgent = new Agent({
  headersTimeout: TRANSCRIPTION_FETCH_TIMEOUT_MS,
  bodyTimeout: TRANSCRIPTION_FETCH_TIMEOUT_MS,
});

type FetchWithDispatcher = RequestInit & { dispatcher: Agent };

/** Search window (seconds) around a size-based target for silence midpoints. */
const TRANSCRIPTION_CHUNK_SILENCE_WINDOW_SEC = 45;

function isFetchTimeoutError(err: unknown): boolean {
  const name = err instanceof Error ? err.name : "";
  const msg = err instanceof Error ? err.message : String(err);
  return (
    name === "HeadersTimeoutError" ||
    name === "BodyTimeoutError" ||
    name === "TimeoutError" ||
    /timeout/i.test(msg)
  );
}

function transcriptionTimeoutMessage(): string {
  const minutes = Math.round(TRANSCRIPTION_FETCH_TIMEOUT_MS / 60_000);
  return `Transcription timed out after ${minutes} minutes. The Whisper service may still be processing; try again or increase TRANSCRIPTION_FETCH_TIMEOUT_MS.`;
}

/** In-memory render status per episode: only one build per episode at a time. Cleared when returning 'done' or 'failed'. */
export const renderStatusByEpisode = new Map<string, "building" | "done" | "failed">();
export const renderErrorByEpisode = new Map<string, string>();

/** In-memory transcript generation status per episode. Cleared when returning 'done' or 'failed'. */
export const transcriptStatusByEpisode = new Map<string, "transcribing" | "done" | "failed">();
export const transcriptErrorByEpisode = new Map<string, string>();

/** In-memory transcript generation status per segment. Cleared when returning 'done' or 'failed'. */
export const transcriptStatusBySegment = new Map<string, "transcribing" | "done" | "failed">();
export const transcriptErrorBySegment = new Map<string, string>();

/** In-memory video generation status per episode. Cleared when returning 'done' or 'failed'. */
export const videoGenStatusByEpisode = new Map<string, "generating" | "done" | "failed">();
export const videoGenErrorByEpisode = new Map<string, string>();

/** Episodes currently in video generation (mutex). Removed when generation finishes (success or failure). */
export const videoGenLockedEpisodes = new Set<string>();

export function transcriptPath(audioPath: string): string {
  return audioPath.replace(/\.[^.]+$/, ".txt");
}

/** Max transcript size: 2MB. */
export const TRANSCRIPT_MAX_BYTES = 2 * 1024 * 1024;

/** Strip HTML/XML tags and dangerous control chars from transcript text before saving. Keeps newlines and tabs. */
export function sanitizeTranscriptText(s: string): string {
  let out = s.replace(/<[^>]*>/g, "");
  out = out.replace(/[\u0000-\u0008\u000B-\u000C\u000E-\u001F\u007F]/g, ""); // eslint-disable-line no-control-regex
  return out;
}

/** Validate transcript content before saving. Returns error message or null. */
export function validateTranscriptContent(text: string): string | null {
  const sizeBytes = Buffer.byteLength(text, "utf8");
  if (sizeBytes > TRANSCRIPT_MAX_BYTES) {
    return `Transcript too large (max ${TRANSCRIPT_MAX_BYTES / 1024 / 1024}MB)`;
  }
  if (text.includes("\0")) {
    return "Transcript contains invalid characters";
  }
  const trimmedStart = text.trimStart();
  const firstLine = trimmedStart.split("\n")[0] ?? "";
  if (firstLine.startsWith("#!")) {
    return "Transcript appears to be a script file, not SRT content";
  }
  const lowerStart = trimmedStart.toLowerCase().slice(0, 100);
  if (lowerStart.startsWith("<?php") || lowerStart.startsWith("<script")) {
    return "Transcript contains invalid content";
  }
  return null;
}

export function waveformPath(audioPath: string): string {
  return audioPath.replace(/\.[^.]+$/, WAVEFORM_EXTENSION);
}

/** Merge overlapping or adjacent trim ranges so effective duration and toEffectiveTime match removeRangesAndExportToWav output. */
export function mergeTrimRanges(
  ranges: Array<[number, number]>,
  durationSec: number,
): Array<[number, number]> {
  if (ranges.length <= 1) return ranges;
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const [start, end] of sorted) {
    if (start >= durationSec || end <= 0) continue;
    const clampedStart = Math.max(0, start);
    const clampedEnd = Math.min(durationSec, end);
    if (clampedStart >= clampedEnd) continue;
    const last = merged[merged.length - 1];
    if (last && clampedStart <= last[1]) {
      last[1] = Math.max(last[1], clampedEnd);
    } else {
      merged.push([clampedStart, clampedEnd]);
    }
  }
  return merged;
}

/** Map actual time to effective (playable) time when trim ranges exclude sections. */
export function toEffectiveTime(
  actualTime: number,
  trimRanges: Array<[number, number]>,
): number {
  let trimmed = 0;
  for (const [start, end] of trimRanges) {
    if (end <= actualTime) trimmed += end - start;
    else if (start < actualTime) trimmed += actualTime - start;
  }
  return actualTime - trimmed;
}

export function formatSrtTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const millis = Math.floor((seconds % 1) * 1000);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
}

export function parseSrtTime(timeStr: string): number {
  const normalized = timeStr.replace(",", ".");
  const parts = normalized.split(":");
  if (parts.length !== 3) return 0;
  const hours = parseFloat(parts[0] || "0");
  const minutes = parseFloat(parts[1] || "0");
  const seconds = parseFloat(parts[2] || "0");
  return hours * 3600 + minutes * 60 + seconds;
}

export interface SrtEntry {
  index: number;
  start: string;
  end: string;
  text: string;
}

export function parseSrt(srtText: string): SrtEntry[] {
  const entries: SrtEntry[] = [];
  const blocks = srtText.split(/\n\s*\n/).filter((b) => b.trim());
  for (const block of blocks) {
    const lines = block.trim().split("\n");
    if (lines.length < 3) continue;
    const indexStr = lines[0]?.trim();
    const timeLine = lines[1]?.trim();
    if (!indexStr || !timeLine || !timeLine.includes("-->")) continue;
    const [start, end] = timeLine.split("-->").map((s) => s.trim());
    const text = lines.slice(2).join("\n").trim();
    if (start && end && text) {
      const index = parseInt(indexStr, 10);
      if (!Number.isNaN(index)) {
        entries.push({ index, start, end, text });
      }
    }
  }
  return entries;
}

/** Clip SRT entries to [windowStart, windowEnd) and shift times so windowStart becomes 0. */
export function adjustSrtEntriesForWindow(
  entries: SrtEntry[],
  windowStart: number,
  windowEnd: number,
): SrtEntry[] {
  return entries
    .map((entry) => {
      const entryStartSec = parseSrtTime(entry.start);
      const entryEndSec = parseSrtTime(entry.end);
      if (entryEndSec <= windowStart || entryStartSec >= windowEnd) return null;
      const adjustedStart = Math.max(0, entryStartSec - windowStart);
      const adjustedEnd = Math.min(
        windowEnd - windowStart,
        entryEndSec - windowStart,
      );
      if (adjustedEnd <= adjustedStart) return null;
      return {
        ...entry,
        start: formatSrtTime(adjustedStart),
        end: formatSrtTime(adjustedEnd),
      };
    })
    .filter((e): e is SrtEntry => e !== null);
}

export function formatSrtEntries(entries: SrtEntry[]): string {
  return entries
    .map(
      (entry, i) =>
        `${i + 1}\n${entry.start} --> ${entry.end}\n${entry.text}\n`,
    )
    .join("\n");
}

/**
 * Plan absolute cut times [0, ..., durationSec] for chunked transcription.
 * Prefers silence midpoints near each ~maxBytes target; falls back to hard cuts.
 */
export function planTranscriptionChunkBoundaries(
  sizeBytes: number,
  durationSec: number,
  silencePeriods: SilencePeriod[],
  maxBytes: number,
  searchWindowSec: number = TRANSCRIPTION_CHUNK_SILENCE_WINDOW_SEC,
): number[] {
  if (durationSec <= 0) return [0, 0];
  if (sizeBytes <= maxBytes) return [0, durationSec];

  const bytesPerSec = sizeBytes / durationSec;
  const targetChunkSec = maxBytes / bytesPerSec;
  if (!Number.isFinite(targetChunkSec) || targetChunkSec <= 0) {
    return [0, durationSec];
  }

  const cuts: number[] = [0];
  let nextTarget = targetChunkSec;

  while (nextTarget < durationSec - 0.5) {
    const lastCut = cuts[cuts.length - 1]!;
    let best: number | null = null;
    let bestDist = Infinity;

    for (const silence of silencePeriods) {
      const mid = (silence.start + silence.end) / 2;
      if (mid <= lastCut + 1) continue;
      if (mid >= durationSec - 0.5) continue;
      const dist = Math.abs(mid - nextTarget);
      if (dist <= searchWindowSec && dist < bestDist) {
        bestDist = dist;
        best = mid;
      }
    }

    let cut = best ?? nextTarget;
    if (cut <= lastCut + 0.5) {
      cut = Math.min(durationSec, lastCut + targetChunkSec);
    }
    cut = Math.min(cut, durationSec);
    if (cut <= lastCut + 0.5) break;
    cuts.push(cut);
    nextTarget = cut + targetChunkSec;
  }

  if (cuts[cuts.length - 1]! < durationSec) {
    cuts.push(durationSec);
  }
  return cuts;
}

/** Offset and concatenate per-chunk SRT texts into one transcript. */
export function mergeChunkSrts(
  chunks: Array<{ offsetSec: number; srt: string }>,
): string {
  const all: SrtEntry[] = [];
  for (const chunk of chunks) {
    for (const entry of parseSrt(chunk.srt)) {
      all.push({
        ...entry,
        start: formatSrtTime(parseSrtTime(entry.start) + chunk.offsetSec),
        end: formatSrtTime(parseSrtTime(entry.end) + chunk.offsetSec),
      });
    }
  }
  return formatSrtEntries(all);
}

function throwIfChunkTooLarge(status: number): void {
  if (status === 413) {
    throw new Error("CHUNK_TOO_LARGE");
  }
}

function logTranscriptionHttpFailure(
  provider: string,
  status: number,
  bodySnippet: string,
): void {
  const snippet = bodySnippet.replace(/\s+/g, " ").trim().slice(0, 200);
  console.error(
    `[transcription] ${provider} request failed: status=${status}${snippet ? ` body=${snippet}` : ""}`,
  );
}

type TranscriptionProviderCall = (
  audioPath: string,
  allowedBaseDir: string,
) => Promise<string | null>;

async function transcribeWithProvider(
  audioPath: string,
  allowedBaseDir: string,
  settings: ReturnType<typeof readSettings>,
): Promise<string | null> {
  if (settings.transcription_provider === "self_hosted") {
    const whisperUrl = settings.whisper_asr_url?.trim();
    if (!whisperUrl) return null;
    return generateSrtFromWhisper(audioPath, allowedBaseDir, whisperUrl);
  }
  if (settings.transcription_provider === "openai") {
    const url =
      settings.openai_transcription_url?.trim() ||
      OPENAI_TRANSCRIPTION_DEFAULT_URL;
    const apiKey = settings.openai_transcription_api_key?.trim();
    const model = settings.transcription_model?.trim() || "whisper-1";
    if (!apiKey) return null;
    return generateSrtFromOpenAI(audioPath, allowedBaseDir, {
      url,
      apiKey,
      model,
    });
  }
  return null;
}

type MarkerLike = {
  time: number;
  title?: string;
  color?: string;
  markerType?: "" | "chapter" | "soundbite";
  duration?: number;
};

function clampSoundbiteMarker(
  marker: MarkerLike,
  segmentDuration: number,
): MarkerLike {
  const out = { ...marker };
  if (out.markerType !== "soundbite" || typeof out.duration !== "number") {
    return out;
  }
  const maxDur = Math.max(0, segmentDuration - out.time);
  if (maxDur < 15) {
    out.markerType = "";
    delete out.duration;
    return out;
  }
  out.duration = Math.min(120, Math.min(out.duration, maxDur));
  return out;
}

/** Partition markers at splitSec. Markers at/after split move to the second segment (time shifted). */
export function partitionMarkersAtSplit(
  markers: MarkerLike[],
  splitSec: number,
  durationA: number,
  durationB: number,
): { before: MarkerLike[]; after: MarkerLike[] } {
  const before: MarkerLike[] = [];
  const after: MarkerLike[] = [];
  for (const m of markers) {
    if (typeof m.time !== "number" || !Number.isFinite(m.time)) continue;
    if (m.time < splitSec) {
      before.push(clampSoundbiteMarker(m, durationA));
    } else {
      after.push(
        clampSoundbiteMarker({ ...m, time: m.time - splitSec }, durationB),
      );
    }
  }
  return { before, after };
}

/** Partition trim ranges at splitSec; ranges that cross the split are clipped into both halves. */
export function partitionTrimRangesAtSplit(
  ranges: Array<[number, number]>,
  splitSec: number,
): { before: Array<[number, number]>; after: Array<[number, number]> } {
  const before: Array<[number, number]> = [];
  const after: Array<[number, number]> = [];
  for (const range of ranges) {
    if (!Array.isArray(range) || range.length < 2) continue;
    const start = Number(range[0]);
    const end = Number(range[1]);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) continue;
    if (end <= splitSec) {
      before.push([start, end]);
    } else if (start >= splitSec) {
      after.push([start - splitSec, end - splitSec]);
    } else {
      if (start < splitSec) before.push([start, splitSec]);
      if (end > splitSec) after.push([0, end - splitSec]);
    }
  }
  return { before, after };
}

/**
 * Run transcription (Whisper or OpenAI) on an audio file. Returns SRT text.
 * Large files are split into ~TRANSCRIPTION_CHUNK_MAX_BYTES chunks at silence gaps.
 * Throws if provider not configured or transcription fails. May throw with message "CHUNK_TOO_LARGE".
 */
export async function runTranscription(
  audioPath: string,
  allowedBaseDir: string,
  settings: ReturnType<typeof readSettings>,
): Promise<string> {
  assertPathUnder(audioPath, allowedBaseDir);
  const sizeBytes = statSync(audioPath).size;
  const call: TranscriptionProviderCall = (path, base) =>
    transcribeWithProvider(path, base, settings);

  if (sizeBytes <= TRANSCRIPTION_CHUNK_MAX_BYTES) {
    const text = await call(audioPath, allowedBaseDir);
    if (!text) {
      throw new Error(
        "Transcription service failed. Check Settings and try again.",
      );
    }
    return text;
  }

  const durationSec = await audioService.probeAudioDurationFloat(
    audioPath,
    allowedBaseDir,
  );
  const silencePeriods = await audioService.detectSilencePeriods(
    audioPath,
    allowedBaseDir,
    { thresholdSeconds: 0.3, silenceThresholdDb: -40 },
  );
  // Chunks are re-encoded at 128kbps; plan cuts from that bitrate so uploads stay under maxBytes.
  const outputBytesPerSec = (128 * 1000) / 8;
  const estimatedOutputBytes = durationSec * outputBytesPerSec;
  const boundaries = planTranscriptionChunkBoundaries(
    estimatedOutputBytes,
    durationSec,
    silencePeriods,
    TRANSCRIPTION_CHUNK_MAX_BYTES,
  );

  const tempChunks: string[] = [];
  try {
    const merged: Array<{ offsetSec: number; srt: string }> = [];
    for (let i = 0; i < boundaries.length - 1; i++) {
      const startSec = boundaries[i]!;
      const endSec = boundaries[i + 1]!;
      const chunkDuration = endSec - startSec;
      if (chunkDuration <= 0) continue;

      const chunkPath = await audioService.extractAudioChunkToTmp(
        audioPath,
        allowedBaseDir,
        startSec,
        chunkDuration,
      );
      tempChunks.push(chunkPath);

      const srt = await call(chunkPath, tmpdir());
      if (!srt) {
        throw new Error(
          "Transcription service failed. Check Settings and try again.",
        );
      }
      merged.push({ offsetSec: startSec, srt });
    }

    if (merged.length === 0) {
      throw new Error(
        "Transcription service failed. Check Settings and try again.",
      );
    }
    return mergeChunkSrts(merged);
  } finally {
    for (const p of tempChunks) {
      try {
        if (existsSync(p)) unlinkSync(p);
      } catch {
        // ignore cleanup errors
      }
    }
  }
}

/**
 * Call Whisper ASR with an audio file and return SRT text, or null on failure.
 * Used for segment transcripts and for episode-level transcript after render.
 */
export async function generateSrtFromWhisper(
  audioPath: string,
  allowedBaseDir: string,
  whisperAsrUrl: string,
): Promise<string | null> {
  const url = whisperAsrUrl.trim();
  if (!url) return null;
  try {
    const u = new URL(url);
    const pathname = u.pathname.replace(/\/$/, "") || "";
    if (!pathname.endsWith("asr")) {
      u.pathname = pathname ? `${pathname}/asr` : "/asr";
    }
    u.searchParams.set("output", "srt");
    const whisperUrl = u.toString();
    assertPathUnder(audioPath, allowedBaseDir);
    const buffer = readFileSync(audioPath);
    const mime = contentTypeFromAudioPath(audioPath);
    const ext = (extname(audioPath).replace(/^\./, "") || "mp3").toLowerCase();
    const form = new FormData();
    form.append(
      "audio_file",
      new Blob([new Uint8Array(buffer)], { type: mime }),
      `audio.${ext}`,
    );
    const res = await fetch(whisperUrl, {
      method: "POST",
      body: form,
      dispatcher: transcriptionAgent,
    } as FetchWithDispatcher);
    if (!res.ok) {
      const bodySnippet = await res.text().catch(() => "");
      logTranscriptionHttpFailure("whisper", res.status, bodySnippet);
      throwIfChunkTooLarge(res.status);
      return null;
    }
    const contentType = res.headers.get("content-type") || "";
    let text: string;
    if (contentType.includes("application/json")) {
      const data = (await res.json()) as {
        text?: string;
        srt?: string;
        vtt?: string;
        segments?: Array<{ start?: number; end?: number; text?: string }>;
      };
      if (typeof data?.srt === "string") {
        text = data.srt.trim();
      } else if (typeof data?.vtt === "string") {
        text = data.vtt.trim();
      } else if (Array.isArray(data?.segments) && data.segments.length > 0) {
        text = data.segments
          .map((seg, i) => {
            const start = seg.start ?? 0;
            const end = seg.end ?? start + 1;
            const startTime = formatSrtTime(start);
            const endTime = formatSrtTime(end);
            return `${i + 1}\n${startTime} --> ${endTime}\n${seg.text || ""}\n`;
          })
          .join("\n");
      } else if (typeof data?.text === "string") {
        text = data.text.trim();
      } else {
        text = "";
      }
    } else {
      text = (await res.text()).trim();
    }
    return text || null;
  } catch (err) {
    if (err instanceof Error && err.message === "CHUNK_TOO_LARGE") throw err;
    if (isFetchTimeoutError(err)) {
      throw new Error(transcriptionTimeoutMessage());
    }
    return null;
  }
}

/**
 * Call OpenAI Audio API with an audio file and return SRT text, or null on failure.
 * Uses multipart/form-data: file, model. For gpt-4o-transcribe / gpt-4o-mini-transcribe
 * only response_format=json is supported; we request json and convert text to a single SRT cue.
 * For whisper-1 we can request response_format=srt.
 */
export async function generateSrtFromOpenAI(
  audioPath: string,
  allowedBaseDir: string,
  options: { url: string; apiKey: string; model: string },
): Promise<string | null> {
  const { url, apiKey, model } = options;
  if (!url?.trim() || !apiKey?.trim()) return null;
  const modelVal = (model || "whisper-1").trim();
  const supportsSrt = modelVal.toLowerCase() === "whisper-1";
  try {
    assertPathUnder(audioPath, allowedBaseDir);
    let durationSec = 0;
    try {
      const probe = await audioService.probeAudio(audioPath, allowedBaseDir);
      durationSec = Math.max(0, probe.durationSec);
    } catch {
      // keep 0 if probe fails
    }
    const buffer = readFileSync(audioPath);
    const mime = contentTypeFromAudioPath(audioPath);
    const ext = (extname(audioPath).replace(/^\./, "") || "mp3").toLowerCase();
    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array(buffer)], { type: mime }),
      `audio.${ext}`,
    );
    form.append("model", modelVal);
    form.append("response_format", supportsSrt ? "srt" : "json");
    const res = await fetch(url.trim(), {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      dispatcher: transcriptionAgent,
    } as FetchWithDispatcher);
    const bodyText = await res.text();
    if (!res.ok) {
      logTranscriptionHttpFailure("openai", res.status, bodyText);
      throwIfChunkTooLarge(res.status);
      return null;
    }
    if (supportsSrt) {
      return bodyText.trim() || null;
    }
    try {
      const data = JSON.parse(bodyText) as { text?: string };
      const text = typeof data?.text === "string" ? data.text.trim() : "";
      if (!text) return null;
      const endTime =
        durationSec > 0 ? formatSrtTime(durationSec) : "00:00:01,000";
      return `1\n00:00:00,000 --> ${endTime}\n${text}\n`;
    } catch {
      return null;
    }
  } catch (err) {
    if (err instanceof Error && err.message === "CHUNK_TOO_LARGE") throw err;
    if (isFetchTimeoutError(err)) {
      throw new Error(transcriptionTimeoutMessage());
    }
    return null;
  }
}

export function removeSrtEntryAndAdjustTimings(
  entries: SrtEntry[],
  removeArrayIndex: number,
  removedDurationSec: number,
): string {
  const removedEntry = entries[removeArrayIndex];
  if (!removedEntry)
    return entries
      .map((e, i) => `${i + 1}\n${e.start} --> ${e.end}\n${e.text}\n`)
      .join("\n");

  const filtered = entries.filter((_, i) => i !== removeArrayIndex);
  const removedStartSec = parseSrtTime(removedEntry.start);

  const adjusted = filtered.map((entry) => {
    const startSec = parseSrtTime(entry.start);
    const endSec = parseSrtTime(entry.end);

    if (startSec >= removedStartSec) {
      return {
        ...entry,
        start: formatSrtTime(Math.max(0, startSec - removedDurationSec)),
        end: formatSrtTime(Math.max(0, endSec - removedDurationSec)),
      };
    }
    return entry;
  });

  return adjusted
    .map((entry, i) => {
      return `${i + 1}\n${entry.start} --> ${entry.end}\n${entry.text}\n`;
    })
    .join("\n");
}

export const ALLOWED_MIME = [
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
  "audio/mpeg",
  "audio/mp3",
  "audio/webm",
  "audio/ogg",
];
