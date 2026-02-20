import { readFileSync } from "fs";
import { extname } from "path";
import { readSettings } from "../settings/index.js";
import { assertPathUnder } from "../../services/paths.js";
import * as audioService from "../../services/audio.js";
import { contentTypeFromAudioPath } from "../../utils/audio.js";
import { OPENAI_TRANSCRIPTION_DEFAULT_URL, WAVEFORM_EXTENSION } from "../../config.js";

/** In-memory render status per episode: only one build per episode at a time. Cleared when returning 'done' or 'failed'. */
export const renderStatusByEpisode = new Map<string, "building" | "done" | "failed">();
export const renderErrorByEpisode = new Map<string, string>();

/** In-memory transcript generation status per episode. Cleared when returning 'done' or 'failed'. */
export const transcriptStatusByEpisode = new Map<string, "transcribing" | "done" | "failed">();
export const transcriptErrorByEpisode = new Map<string, string>();

/** In-memory video generation status per episode. Cleared when returning 'done' or 'failed'. */
export const videoGenStatusByEpisode = new Map<string, "generating" | "done" | "failed">();
export const videoGenErrorByEpisode = new Map<string, string>();

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

/**
 * Run transcription (Whisper or OpenAI) on an audio file. Returns SRT text.
 * Throws if provider not configured or transcription fails. May throw with message "CHUNK_TOO_LARGE".
 */
export async function runTranscription(
  audioPath: string,
  allowedBaseDir: string,
  settings: ReturnType<typeof readSettings>,
): Promise<string> {
  let text: string | null = null;
  if (settings.transcription_provider === "self_hosted") {
    const whisperUrl = settings.whisper_asr_url?.trim();
    if (whisperUrl) {
      text = await generateSrtFromWhisper(audioPath, allowedBaseDir, whisperUrl);
    }
  } else if (settings.transcription_provider === "openai") {
    const url =
      settings.openai_transcription_url?.trim() ||
      OPENAI_TRANSCRIPTION_DEFAULT_URL;
    const apiKey = settings.openai_transcription_api_key?.trim();
    const model = settings.transcription_model?.trim() || "whisper-1";
    if (apiKey) {
      text = await generateSrtFromOpenAI(audioPath, allowedBaseDir, {
        url,
        apiKey,
        model,
      });
    }
  }
  if (!text) {
    throw new Error(
      "Transcription service failed. Check Settings and try again.",
    );
  }
  return text;
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
    const res = await fetch(whisperUrl, { method: "POST", body: form });
    if (!res.ok) return null;
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
  } catch {
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
    });
    const bodyText = await res.text();
    if (!res.ok) return null;
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
  } catch {
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
