import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
  statSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execFile } from "child_process";
import { promisify } from "util";
import { nanoid } from "nanoid";
import { AUDIOWAVEFORM_PATH, FFMPEG_PATH, FFPROBE_PATH, WHISPER_ASR_URL } from "../config.js";

void AUDIOWAVEFORM_PATH;

const exec = promisify(execFile);
const CHUNK_MAX_BYTES = 15 * 1024 * 1024;

async function probeDurationSec(audioPath: string): Promise<number> {
  const { stdout } = await exec(
    FFPROBE_PATH,
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      audioPath,
    ],
    { maxBuffer: 64 * 1024 },
  );
  const d = parseFloat(stdout.trim());
  if (!Number.isFinite(d) || d <= 0) throw new Error("Could not probe duration");
  return d;
}

async function extractChunk(
  source: string,
  startSec: number,
  durationSec: number,
  outPath: string,
): Promise<void> {
  await exec(
    FFMPEG_PATH,
    [
      "-y",
      "-ss",
      String(startSec),
      "-t",
      String(durationSec),
      "-i",
      source,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-b:a",
      "128k",
      outPath,
    ],
    { maxBuffer: 8 * 1024 * 1024 },
  );
}

function whisperAsrUrl(): string {
  const u = new URL(WHISPER_ASR_URL.trim());
  const pathname = u.pathname.replace(/\/$/, "") || "";
  if (!pathname.endsWith("asr")) {
    u.pathname = pathname ? `${pathname}/asr` : "/asr";
  }
  u.searchParams.set("output", "srt");
  return u.toString();
}

async function whisperOne(audioPath: string): Promise<string> {
  const buffer = readFileSync(audioPath);
  const form = new FormData();
  form.append(
    "audio_file",
    new Blob([buffer], { type: "audio/mpeg" }),
    "audio.mp3",
  );
  const res = await fetch(whisperAsrUrl(), { method: "POST", body: form });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    if (res.status === 413) throw new Error("CHUNK_TOO_LARGE");
    throw new Error(`Whisper failed: ${res.status} ${t.slice(0, 200)}`);
  }
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    const data = (await res.json()) as { srt?: string; text?: string };
    return (data.srt || data.text || "").trim();
  }
  return (await res.text()).trim();
}

function parseSrtTime(t: string): number {
  const m = t.trim().match(/(\d+):(\d+):(\d+)[,.](\d+)/);
  if (!m) return 0;
  return (
    Number(m[1]) * 3600 +
    Number(m[2]) * 60 +
    Number(m[3]) +
    Number(m[4]) / 1000
  );
}

function formatSrtTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.round((sec - Math.floor(sec)) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

function shiftSrt(srt: string, offsetSec: number): string {
  const blocks = srt.trim().split(/\n\s*\n/);
  const out: string[] = [];
  let i = 1;
  for (const block of blocks) {
    const lines = block.split("\n");
    if (lines.length < 2) continue;
    const timeLine = lines.find((l) => l.includes("-->"));
    if (!timeLine) continue;
    const [a, b] = timeLine.split("-->").map((s) => s.trim());
    const start = parseSrtTime(a!) + offsetSec;
    const end = parseSrtTime(b!) + offsetSec;
    const text = lines
      .filter((l) => !/^\d+$/.test(l.trim()) && !l.includes("-->"))
      .join("\n");
    out.push(
      `${i}\n${formatSrtTime(start)} --> ${formatSrtTime(end)}\n${text}`,
    );
    i++;
  }
  return out.join("\n\n") + (out.length ? "\n" : "");
}

/** Transcribe local audio file; write SRT to outPath. */
export async function runTranscribeJob(
  audioPath: string,
  outPath: string,
): Promise<void> {
  mkdirSync(dirnameSafe(outPath), { recursive: true });
  const size = statSync(audioPath).size;
  if (size <= CHUNK_MAX_BYTES) {
    const srt = await whisperOne(audioPath);
    if (!srt) throw new Error("Empty transcript from Whisper");
    writeFileSync(outPath, srt, "utf-8");
    return;
  }

  const duration = await probeDurationSec(audioPath);
  const bytesPerSec = (128 * 1000) / 8;
  const chunkDur = Math.max(30, Math.floor(CHUNK_MAX_BYTES / bytesPerSec) * 0.85);
  const temps: string[] = [];
  const parts: string[] = [];
  try {
    for (let start = 0; start < duration; start += chunkDur) {
      const dur = Math.min(chunkDur, duration - start);
      if (dur < 0.5) break;
      const chunkPath = join(tmpdir(), `hfm-wchunk-${nanoid()}.mp3`);
      temps.push(chunkPath);
      await extractChunk(audioPath, start, dur, chunkPath);
      if (!existsSync(chunkPath) || statSync(chunkPath).size === 0) continue;
      const srt = await whisperOne(chunkPath);
      if (srt) parts.push(shiftSrt(srt, start));
    }
    if (parts.length === 0) throw new Error("Transcription produced no segments");
    // Re-number cues
    writeFileSync(outPath, renumberSrt(parts.join("\n\n")), "utf-8");
  } finally {
    for (const p of temps) {
      try {
        if (existsSync(p)) unlinkSync(p);
      } catch {
        /* ignore */
      }
    }
  }
}

function dirnameSafe(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(0, i) : ".";
}

function renumberSrt(srt: string): string {
  const blocks = srt.trim().split(/\n\s*\n/);
  const out: string[] = [];
  let i = 1;
  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.trim().length);
    if (lines.length < 2) continue;
    const timeIdx = lines.findIndex((l) => l.includes("-->"));
    if (timeIdx < 0) continue;
    const text = lines.slice(timeIdx + 1).join("\n");
    out.push(`${i}\n${lines[timeIdx]}\n${text}`);
    i++;
  }
  return out.join("\n\n") + "\n";
}
