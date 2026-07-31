import { spawn, execFile } from "child_process";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";
import { promisify } from "util";
import type { Writable } from "stream";
import type {
  VideoOrientation,
  VideoResolution,
  VideoSpectrumStyle,
  VideoWaveformType,
} from "@harborfm/shared";

const exec = promisify(execFile);

/** Binary paths for encode tools (defaults to PATH names). */
export type VideoGenTools = {
  ffmpegPath: string;
  ffprobePath: string;
  audiowaveformPath: string;
};

export function resolveVideoGenTools(
  partial?: Partial<VideoGenTools>,
): VideoGenTools {
  return {
    ffmpegPath: partial?.ffmpegPath?.trim() || "ffmpeg",
    ffprobePath: partial?.ffprobePath?.trim() || "ffprobe",
    audiowaveformPath: partial?.audiowaveformPath?.trim() || "audiowaveform",
  };
}

export type {
  VideoOrientation,
  VideoResolution,
  VideoSpectrumStyle,
  VideoWaveformType,
};

interface WaveformDataForVideo {
  data: number[];
  length: number;
  sample_rate: number;
  samples_per_pixel: number;
  bits: number;
  channels: number;
}

/** Timeout for video generation (long episodes). On timeout the process is killed. */
const VIDEO_GEN_TIMEOUT_MS = 30 * 60 * 1000;

/** Max chars of stderr to include in user-facing message (last portion). */
const STDERR_TAIL_CHARS = 800;

/** Max chars to keep in memory while accumulating stderr (avoids unbounded growth on long encodes). */
const MAX_STDERR_CAPTURE = 8000;

/** Max chars to keep in memory while accumulating stdout. */
const MAX_STDOUT_CAPTURE = 2000;

/** Error with optional FFmpeg stderr for logging. */
export interface VideoGenerationError extends Error {
  ffmpegStderr?: string;
}

/** Take the last N chars of stderr; strip leading newlines and truncate. */
function stderrTail(stderr: string, maxChars: number): string {
  const trimmed = stderr.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return trimmed.slice(-maxChars).replace(/^[^\n]*\n?/, "");
}

/** Conservative video bitrate (Mbps) for H.264 CRF 23 by resolution. Audio is 0.192 Mbps. */
const VIDEO_BITRATE_MBPS: Record<VideoResolution, number> = {
  "480p": 0.7,
  "720p": 1.2,
  "1080p": 2.5,
};

const AUDIO_BITRATE_MBPS = 0.192;
/** Safety factor so we don't underestimate (1.2 = 20% padding). */
const ESTIMATE_SAFETY_FACTOR = 1.2;

/**
 * Estimated output size in bytes for an episode video (libx264 CRF 23, 192k AAC).
 */
export function estimateEpisodeVideoBytes(
  durationSec: number,
  resolution?: VideoResolution,
): number {
  const r = resolution ?? "720p";
  const videoMbps = VIDEO_BITRATE_MBPS[r] ?? VIDEO_BITRATE_MBPS["720p"];
  const bytesPerSec = ((videoMbps + AUDIO_BITRATE_MBPS) * 1e6) / 8;
  return Math.ceil(durationSec * bytesPerSec * ESTIMATE_SAFETY_FACTOR);
}

/** Probe audio duration via ffprobe JSON. Paths are trusted under workDir. */
async function probeAudio(
  audioPath: string,
  _workDir: string,
  tools: VideoGenTools,
): Promise<{ durationSec: number }> {
  const { stdout } = await exec(
    tools.ffprobePath,
    [
      "-v",
      "quiet",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      audioPath,
    ],
    { maxBuffer: 2 * 1024 * 1024 },
  );
  const info = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: Array<{ duration?: string; codec_type?: string }>;
  };
  let durationSec = Math.round(parseFloat(info.format?.duration ?? "0"));
  if (durationSec <= 0 && Array.isArray(info.streams)) {
    const audioStream = info.streams.find((s) => s.codec_type === "audio");
    if (audioStream?.duration) {
      const d = parseFloat(audioStream.duration);
      if (!Number.isNaN(d)) durationSec = Math.round(d);
    }
  }
  if (durationSec <= 0) {
    throw new Error("Could not probe audio duration");
  }
  return { durationSec };
}

/** Generate audiowaveform JSON into workDir/video-waveform.json and return parsed data. */
async function generateWaveformDataForVideo(
  audioPath: string,
  workDir: string,
  tools: VideoGenTools,
  options?: { pixelsPerSecond?: number },
): Promise<WaveformDataForVideo> {
  mkdirSync(workDir, { recursive: true });
  const outPath = join(workDir, "video-waveform.json");
  const pixelsPerSecond = options?.pixelsPerSecond ?? 25;
  await exec(
    tools.audiowaveformPath,
    [
      "-i",
      audioPath,
      "-o",
      outPath,
      "--pixels-per-second",
      String(pixelsPerSecond),
      "--bits",
      "8",
    ],
    { maxBuffer: 8 * 1024 * 1024 },
  );
  const raw = readFileSync(outPath, "utf-8");
  const json = JSON.parse(raw) as {
    channels?: number;
    sample_rate: number;
    samples_per_pixel: number;
    length: number;
    bits: number;
    data: number[];
  };
  return {
    data: json.data,
    length: json.length,
    sample_rate: json.sample_rate,
    samples_per_pixel: json.samples_per_pixel,
    bits: json.bits,
    channels: json.channels ?? 1,
  };
}

/** Resolution to dimensions (width, height) for 16:9 landscape. Portrait swaps. Square uses short edge. */
function resolutionToDimensions(
  resolution: VideoResolution | undefined,
  orientation: VideoOrientation | undefined,
): { width: number; height: number } {
  const r = resolution ?? "720p";
  let width: number;
  let height: number;
  switch (r) {
    case "480p":
      width = 854;
      height = 480;
      break;
    case "720p":
      width = 1280;
      height = 720;
      break;
    case "1080p":
      width = 1920;
      height = 1080;
      break;
    default:
      width = 1280;
      height = 720;
  }
  if (orientation === "square") {
    const side = Math.min(width, height);
    return { width: side, height: side };
  }
  if (orientation === "portrait") {
    [width, height] = [height, width];
  }
  return { width, height };
}

const AMPLITUDE_TO_HEIGHT_FRACTION = 1;

/** One cosine cycle across the width (1 peak, 1 valley). */
const WAVEFORM_COSINE_CYCLES = 2;

/** Radians added to phase per frame so the wave peak slowly drifts over time. */
const WAVEFORM_ENTROPY_SPEED = 0.025;

/** Parse a CSS color string to approximate brightness 0-1. Handles #RGB, #RRGGBB, rgb(r,g,b), rgba(r,g,b,a). */
function colorBrightness(cssColor: string): number {
  const s = String(cssColor).trim();
  const hex3 = /^#([0-9A-Fa-f])([0-9A-Fa-f])([0-9A-Fa-f])$/.exec(s);
  if (hex3) {
    const r = parseInt(hex3[1]! + hex3[1], 16);
    const g = parseInt(hex3[2]! + hex3[2], 16);
    const b = parseInt(hex3[3]! + hex3[3], 16);
    return (r + g + b) / (3 * 255);
  }
  const hex6 = /^#([0-9A-Fa-f]{6})$/.exec(s);
  if (hex6) {
    const n = parseInt(hex6[1]!, 16);
    const r = (n >> 16) & 0xff;
    const g = (n >> 8) & 0xff;
    const b = n & 0xff;
    return (r + g + b) / (3 * 255);
  }
  const rgb = /rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(s);
  if (rgb) {
    const r = Math.min(255, parseInt(rgb[1]!, 10));
    const g = Math.min(255, parseInt(rgb[2]!, 10));
    const b = Math.min(255, parseInt(rgb[3]!, 10));
    return (r + g + b) / (3 * 255);
  }
  return 0.5;
}

/** Key color for canvas + FFmpeg colorkey: white if waveform color is dark, black if light. */
function keyColorForLineColor(lineColor: string): { canvas: string; ffmpeg: string } {
  const brightness = colorBrightness(lineColor);
  if (brightness < 0.5) {
    return { canvas: "#FFFFFF", ffmpeg: "0xFFFFFF" };
  }
  return { canvas: "#000000", ffmpeg: "0x000000" };
}

/** Map style enum to CSS color for node-canvas. */
function waveformLineColor(style: VideoSpectrumStyle): string {
  switch (style) {
    case "spectrum-rainbow":
      return "#FFFFFF";
    case "spectrum-magma":
      return "#FF6B35";
    case "spectrum-viridis":
      return "#2DD4BF";
    default:
      return "#FFFFFF";
  }
}

function asResolution(v: string | undefined): VideoResolution | undefined {
  if (v === "480p" || v === "720p" || v === "1080p") return v;
  return undefined;
}

function asOrientation(v: string | undefined): VideoOrientation | undefined {
  if (v === "landscape" || v === "portrait" || v === "square") return v;
  return undefined;
}

function asWaveformType(v: string | undefined): VideoWaveformType | undefined {
  if (v === "sine" || v === "bars" || v === "circle" || v === "dots") return v;
  return undefined;
}

function asSpectrumStyle(v: string | undefined): VideoSpectrumStyle | undefined {
  if (
    v === "spectrum-rainbow" ||
    v === "spectrum-magma" ||
    v === "spectrum-viridis"
  ) {
    return v;
  }
  return undefined;
}

/**
 * Run FFmpeg with stdin pipe; caller writes frames then ends stdin. Resolves with outPath, rejects with VideoGenerationError.
 */
function runFfmpegWithStdin(
  tools: VideoGenTools,
  args: string[],
  outPath: string,
  writeFrames: (stdin: Writable) => Promise<void>,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(tools.ffmpegPath, args, {
      stdio: ["pipe", "pipe", "pipe"],
    });
    console.log("[video] FFmpeg spawned, pid=%s", child.pid);

    const stdin = child.stdin!;
    let stdout = "";
    let stderr = "";
    let stderrStarted = false;
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = (stdout + chunk.toString()).slice(-MAX_STDOUT_CAPTURE);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (!stderrStarted) {
        stderrStarted = true;
        console.log("[video] FFmpeg stderr: first chunk received");
      }
      stderr = (stderr + chunk.toString()).slice(-MAX_STDERR_CAPTURE);
    });

    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      if (stdout) console.log("[ffmpeg stdout]", stdout);
      const err = new Error("Video generation timed out") as VideoGenerationError;
      err.ffmpegStderr = stderr || undefined;
      reject(err);
    }, VIDEO_GEN_TIMEOUT_MS);

    child.on("error", (err: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (stdout) console.log("[ffmpeg stdout]", stdout);
      const msg =
        err.code === "ENOENT"
          ? "FFmpeg not found. Install ffmpeg and ensure it is on PATH (or set FFMPEG_PATH)."
          : err.message ?? "FFmpeg failed to start";
      const out = new Error(msg) as VideoGenerationError;
      out.ffmpegStderr = stderr || undefined;
      reject(out);
    });

    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      console.log("[video] FFmpeg closed code=%s signal=%s", code, signal ?? "null");
      if (stdout) console.log("[ffmpeg stdout]", stdout);
      if (code === 0 && signal == null) {
        resolve(outPath);
        return;
      }
      const tail = stderrTail(stderr, STDERR_TAIL_CHARS);
      const userMsg = tail
        ? `FFmpeg failed: ${tail}`
        : `FFmpeg exited with code ${code ?? "unknown"}${signal ? ` (signal ${signal})` : ""}`;
      const err = new Error(userMsg) as VideoGenerationError;
      err.ffmpegStderr = stderr || undefined;
      reject(err);
    });

    writeFrames(stdin)
      .then(() => {
        stdin.end();
      })
      .catch((err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          child.kill("SIGKILL");
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });
  });
}

/** Sample waveform at time t (seconds); return amplitude in [0, 1] (half-range of bucket / range, channel 0). */
function sampleWaveformAtTime(wf: WaveformDataForVideo, t: number): number {
  if (wf.length === 0) return 0;
  const idx = (t * wf.sample_rate) / wf.samples_per_pixel;
  const i = Math.max(0, Math.min(wf.length - 1, Math.floor(idx)));
  const stride = wf.channels === 2 ? 4 : 2;
  const minVal = wf.data[stride * i] ?? 0;
  const maxVal = wf.data[stride * i + 1] ?? 0;
  const range = wf.bits === 8 ? 128 : 32768;
  return (maxVal - minVal) / 2 / range;
}

/** Max amplitude (half-range) in waveform data [0..1]. Used so max loudness maps to full strip height. */
function getMaxAmplitudeFromWaveform(wf: WaveformDataForVideo): number {
  if (wf.length === 0) return 1;
  const range = wf.bits === 8 ? 128 : 32768;
  const stride = wf.channels === 2 ? 4 : 2;
  let maxAmp = 0;
  for (let i = 0; i < wf.length; i++) {
    const minVal = wf.data[stride * i] ?? 0;
    const maxVal = wf.data[stride * i + 1] ?? 0;
    const halfRange = (maxVal - minVal) / 2 / range;
    if (halfRange > maxAmp) maxAmp = halfRange;
  }
  return Math.min(1, maxAmp);
}

/** Write RGB24 frame buffer to stream; wait for drain if needed. */
function writeFrameSync(stream: Writable, buffer: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const ok = stream.write(buffer, (err) => {
      if (err) reject(err);
    });
    if (ok) resolve();
    else stream.once("drain", resolve);
  });
}

const TARGET_FPS = 24;

/** Integer thickness -> stroke width in px for sine/circle. Scaled up so the line is clearly visible in the video. */
function strokeWidthToPx(thickness: number): number {
  const t = Math.max(1, Math.round(thickness));
  return Math.max(2, t * 3);
}

/** Smoothing 0-1 -> EMA alpha (higher smoothing = lower alpha = slower change). */
function smoothingToAlpha(smoothing: number): number {
  return Math.max(0.05, Math.min(0.95, 1 - smoothing));
}

export type VideoChapterMarker = { startTime: number; title: string };

export type VideoChapterTitleLayout = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** Resolve the chapter active at time t (last marker with startTime <= t). */
function chapterAtTime(
  chapters: VideoChapterMarker[],
  t: number,
  durationSec: number,
  episodeTitle?: string,
): { index: number; start: number; end: number; title: string } | null {
  if (chapters.length === 0) return null;
  let idx = -1;
  for (let i = 0; i < chapters.length; i++) {
    if ((chapters[i]?.startTime ?? Infinity) <= t) idx = i;
    else break;
  }
  if (idx < 0) {
    const first = chapters[0]!;
    const title = (episodeTitle ?? "").trim();
    if (!title || first.startTime <= 0) return null;
    return {
      index: 0,
      start: 0,
      end: first.startTime,
      title,
    };
  }
  const current = chapters[idx]!;
  const next = chapters[idx + 1];
  const end = next != null ? next.startTime : durationSec;
  return {
    index: idx + 1,
    start: current.startTime,
    end: Math.max(current.startTime, end),
    title: current.title,
  };
}

function truncateTextToWidth(
  ctx: { measureText: (text: string) => { width: number } },
  text: string,
  maxWidth: number,
): string {
  if (maxWidth <= 0) return "";
  if (ctx.measureText(text).width <= maxWidth) return text;
  const ellipsis = "...";
  if (ctx.measureText(ellipsis).width > maxWidth) return "";
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(text.slice(0, mid) + ellipsis).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo) + ellipsis;
}

function parseChapterTitleLayout(v: unknown): VideoChapterTitleLayout | undefined {
  if (v == null || typeof v !== "object") return undefined;
  const rec = v as Record<string, unknown>;
  const x = Number(rec.x);
  const y = Number(rec.y);
  const width = Number(rec.width);
  const height = Number(rec.height);
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height)
  ) {
    return undefined;
  }
  return {
    x: Math.max(0, Math.min(1, x)),
    y: Math.max(0, Math.min(1, y)),
    width: Math.max(0, Math.min(1, width)),
    height: Math.max(0, Math.min(1, height)),
  };
}

function parseVideoChapters(v: unknown): VideoChapterMarker[] {
  if (!Array.isArray(v)) return [];
  const out: VideoChapterMarker[] = [];
  for (const item of v) {
    if (item == null || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const startTime = Number(rec.startTime);
    const title = typeof rec.title === "string" ? rec.title.trim() : "";
    if (!Number.isFinite(startTime) || startTime < 0 || title.length === 0) continue;
    out.push({ startTime, title });
  }
  out.sort((a, b) => a.startTime - b.startTime);
  return out;
}

/**
 * Generate a video from audio + background image with a waveform overlay.
 * Paths are absolute and trusted under workDir (no data-dir sandboxing).
 */
export async function generateVideoToPath(opts: {
  imagePath: string;
  audioPath: string;
  outPath: string;
  workDir: string;
  x: number;
  y: number;
  width: number;
  amplitude: number;
  style?: string;
  strokeWidth?: number;
  smoothing?: number;
  resolution?: string;
  orientation?: string;
  waveformType?: string;
  color?: string;
  chapterTitle?: VideoChapterTitleLayout;
  chapters?: VideoChapterMarker[];
  /** Episode title shown before the first chapter marker. */
  episodeTitle?: string;
  /** Optional binary paths; defaults to ffmpeg/ffprobe/audiowaveform on PATH. */
  tools?: Partial<VideoGenTools>;
}): Promise<string> {
  const { imagePath, audioPath, outPath, workDir } = opts;
  const tools = resolveVideoGenTools(opts.tools);
  if (!existsSync(imagePath)) {
    throw new Error("Background image not found.");
  }
  if (!existsSync(audioPath)) {
    throw new Error("Audio file not found.");
  }

  mkdirSync(workDir, { recursive: true });

  const probe = await probeAudio(audioPath, workDir, tools);
  const durationSec = Math.max(1, probe.durationSec);

  const { width: VIDEO_WIDTH, height: VIDEO_HEIGHT } = resolutionToDimensions(
    asResolution(opts.resolution),
    asOrientation(opts.orientation),
  );
  const thicknessParam = Math.max(1, Math.round(opts.strokeWidth ?? 3));
  const strokeWidthPx = strokeWidthToPx(thicknessParam);
  const barCount = thicknessParam;
  const dotCount = thicknessParam;
  const smoothingAlpha = smoothingToAlpha(opts.smoothing ?? 0.7);
  const style = asSpectrumStyle(opts.style) ?? "spectrum-rainbow";
  const lineColor =
    opts.color !== undefined && opts.color !== ""
      ? String(opts.color)
      : waveformLineColor(style);
  const keyColor = keyColorForLineColor(lineColor);
  const waveformType = asWaveformType(opts.waveformType) ?? "sine";
  const vizHeight = Math.max(
    1,
    Math.min(VIDEO_HEIGHT, Math.round(VIDEO_HEIGHT * opts.amplitude * AMPLITUDE_TO_HEIGHT_FRACTION)),
  );
  const w = Math.max(1, Math.min(VIDEO_WIDTH, Math.round(Number(opts.width) * VIDEO_WIDTH)));
  const xNum = Number(opts.x);
  const yNum = Number(opts.y);
  const centerPxX = Number.isFinite(xNum) ? xNum * VIDEO_WIDTH : VIDEO_WIDTH / 2;
  const centerPxY = Number.isFinite(yNum) ? yNum * VIDEO_HEIGHT : VIDEO_HEIGHT / 2;
  const xPx = Math.round(centerPxX - w / 2);
  const waveX = Math.max(0, Math.min(xPx, VIDEO_WIDTH - w));
  const yPx = Math.round(centerPxY - vizHeight / 2);
  const waveY = Math.max(0, Math.min(yPx, VIDEO_HEIGHT - vizHeight));

  const chapters = (opts.chapters ?? []).slice().sort((a, b) => a.startTime - b.startTime);
  const episodeTitle = (opts.episodeTitle ?? "").trim() || undefined;
  const chapterTitleLayout = opts.chapterTitle;
  const titleEnabled =
    chapterTitleLayout != null &&
    chapters.length > 0 &&
    chapterTitleLayout.width > 0 &&
    chapterTitleLayout.height > 0;

  let titleW = 0;
  let titleH = 0;
  let titleX = 0;
  let titleY = 0;
  if (titleEnabled && chapterTitleLayout) {
    titleW = Math.max(1, Math.min(VIDEO_WIDTH, Math.round(chapterTitleLayout.width * VIDEO_WIDTH)));
    titleH = Math.max(1, Math.min(VIDEO_HEIGHT, Math.round(chapterTitleLayout.height * VIDEO_HEIGHT)));
    const tCenterX = chapterTitleLayout.x * VIDEO_WIDTH;
    const tCenterY = chapterTitleLayout.y * VIDEO_HEIGHT;
    titleX = Math.max(0, Math.min(Math.round(tCenterX - titleW / 2), VIDEO_WIDTH - titleW));
    titleY = Math.max(0, Math.min(Math.round(tCenterY - titleH / 2), VIDEO_HEIGHT - titleH));
  }

  const overlayLeft = titleEnabled ? Math.min(waveX, titleX) : waveX;
  const overlayTop = titleEnabled ? Math.min(waveY, titleY) : waveY;
  const overlayRight = titleEnabled ? Math.max(waveX + w, titleX + titleW) : waveX + w;
  const overlayBottom = titleEnabled
    ? Math.max(waveY + vizHeight, titleY + titleH)
    : waveY + vizHeight;
  const canvasW = Math.max(1, overlayRight - overlayLeft);
  const canvasH = Math.max(1, overlayBottom - overlayTop);
  const waveOx = waveX - overlayLeft;
  const waveOy = waveY - overlayTop;
  const titleOx = titleX - overlayLeft;
  const titleOy = titleY - overlayTop;

  const wf = await generateWaveformDataForVideo(audioPath, workDir, tools, {
    pixelsPerSecond: TARGET_FPS,
  });
  const totalFrames = Math.ceil(durationSec * TARGET_FPS);
  const maxAmplitudeInData = getMaxAmplitudeFromWaveform(wf);
  const { createCanvas } = await import("canvas");
  const waveCanvas = createCanvas(w, vizHeight);
  const waveCtx = waveCanvas.getContext("2d");
  const canvas = createCanvas(canvasW, canvasH);
  const ctx = canvas.getContext("2d");
  const halfH = vizHeight / 2;
  const ampScale = halfH / Math.max(maxAmplitudeInData, 0.05);
  /** Amplitude scaled to [0, halfH]; max loudness maps to full strip height. */
  const effectiveAmp = (amp: number) => amp * ampScale;

  const titleFontSize = titleEnabled
    ? Math.max(10, Math.min(titleH * 0.55, Math.floor(titleH * 0.7)))
    : 0;
  const titleBarH = titleEnabled ? Math.max(2, Math.round(titleH * 0.12)) : 0;
  const titleFont = `600 ${titleFontSize}px "DejaVu Sans", "Liberation Sans", sans-serif`;

  let prevAmp = 0;

  const filterComplex = [
    `[0:v]scale=${VIDEO_WIDTH}:${VIDEO_HEIGHT}:force_original_aspect_ratio=decrease,` +
      `pad=${VIDEO_WIDTH}:${VIDEO_HEIGHT}:(ow-iw)/2:(oh-ih)/2[bg]`,
    `[1:v]colorkey=${keyColor.ffmpeg}:0.01:0.0[viz]`,
    `[bg][viz]overlay=${overlayLeft}:${overlayTop}[outv]`,
  ].join(";");

  const args = [
    "-loglevel",
    "info",
    "-loop",
    "1",
    "-i",
    imagePath,
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgba",
    "-s",
    `${canvasW}x${canvasH}`,
    "-r",
    String(TARGET_FPS),
    "-i",
    "pipe:0",
    "-i",
    audioPath,
    "-filter_complex",
    filterComplex,
    "-map",
    "[outv]",
    "-map",
    "2:a",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-r",
    String(TARGET_FPS),
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-shortest",
    "-y",
    outPath,
  ];

  console.log("[video] FFmpeg args (pipe input)", args.slice(0, 20), "...");

  const drawWaveform = (amp: number, frameIndex: number) => {
    waveCtx.fillStyle = keyColor.canvas;
    waveCtx.fillRect(0, 0, w, vizHeight);
    waveCtx.strokeStyle = lineColor;
    waveCtx.fillStyle = lineColor;
    waveCtx.lineWidth = strokeWidthPx;
    waveCtx.lineCap = "round";
    waveCtx.lineJoin = "round";

    const eff = effectiveAmp(amp);
    const phaseOffset = frameIndex * WAVEFORM_ENTROPY_SPEED;
    switch (waveformType) {
      case "sine": {
        waveCtx.beginPath();
        waveCtx.moveTo(0.5, halfH + eff * Math.sin(phaseOffset));
        for (let xi = 1; xi <= w; xi++) {
          const yy =
            halfH + eff * Math.sin((2 * Math.PI * WAVEFORM_COSINE_CYCLES * xi) / w + phaseOffset);
          waveCtx.lineTo(xi + 0.5, yy);
        }
        waveCtx.stroke();
        break;
      }
      case "bars": {
        const barGap = 2;
        const barWidth = Math.max(1, (w - (barCount - 1) * barGap) / barCount);
        for (let b = 0; b < barCount; b++) {
          const phase = (2 * Math.PI * WAVEFORM_COSINE_CYCLES * b) / barCount + phaseOffset;
          const barH = Math.max(2, Math.min(vizHeight - 2, eff * (1 + Math.sin(phase))));
          const by = vizHeight - barH;
          const bx = b * (barWidth + barGap);
          waveCtx.fillRect(bx, by, barWidth, barH);
        }
        break;
      }
      case "circle": {
        const centerX = w / 2;
        const centerY = vizHeight / 2;
        const maxRadius = Math.min(w, vizHeight) / 2 - Math.ceil(strokeWidthPx / 2);
        const radius = Math.max(
          2,
          Math.min(maxRadius, eff * (0.92 + 0.08 * Math.sin(phaseOffset))),
        );
        waveCtx.beginPath();
        waveCtx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
        waveCtx.stroke();
        break;
      }
      case "dots": {
        const centerX = w / 2;
        const centerY = halfH;
        const spread = (w / 2) * 0.9;
        const gap = 2;
        const maxR =
          dotCount > 0
            ? Math.max(1, (2 * spread - (dotCount - 1) * gap) / (2 * dotCount))
            : Math.min(strokeWidthPx, spread);
        const baseRadius = Math.max(2, Math.min(strokeWidthPx, maxR * 0.6));
        const amplitudeScale = Math.max(0, (maxR - baseRadius) / 2);
        for (let d = 0; d < dotCount; d++) {
          const dx = centerX - spread + maxR + d * (2 * maxR + gap);
          const phase = (2 * Math.PI * WAVEFORM_COSINE_CYCLES * d) / dotCount + phaseOffset;
          const r = Math.max(
            1,
            Math.min(maxR, baseRadius + eff * amplitudeScale * (1 + Math.sin(phase))),
          );
          waveCtx.beginPath();
          waveCtx.arc(dx, centerY, r, 0, 2 * Math.PI);
          waveCtx.fill();
        }
        break;
      }
      default: {
        waveCtx.beginPath();
        waveCtx.moveTo(0.5, halfH + eff * Math.sin(phaseOffset));
        for (let xi = 1; xi <= w; xi++) {
          const yy =
            halfH + eff * Math.sin((2 * Math.PI * WAVEFORM_COSINE_CYCLES * xi) / w + phaseOffset);
          waveCtx.lineTo(xi + 0.5, yy);
        }
        waveCtx.stroke();
      }
    }
  };

  const drawTitle = (t: number) => {
    if (!titleEnabled) return;
    const chapter = chapterAtTime(chapters, t, durationSec, episodeTitle);
    if (chapter == null) return;

    const padX = Math.max(2, Math.round(titleW * 0.02));
    const textMaxW = Math.max(1, titleW - padX * 2);
    const label =
      chapter.index > 0 ? `${chapter.index}. ${chapter.title}` : chapter.title;
    ctx.font = titleFont;
    ctx.fillStyle = lineColor;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const truncated = truncateTextToWidth(ctx, label, textMaxW);
    const textY = titleOy + (titleH - titleBarH) / 2;
    ctx.fillText(truncated, titleOx + padX, textY);

    const span = Math.max(0.001, chapter.end - chapter.start);
    const progress = Math.max(0, Math.min(1, (t - chapter.start) / span));
    const barY = titleOy + titleH - titleBarH;
    ctx.fillRect(titleOx, barY, Math.round(titleW * progress), titleBarH);
  };

  const frameBuffer = Buffer.alloc(canvasW * canvasH * 4);

  return runFfmpegWithStdin(tools, args, outPath, async (stdin) => {
    for (let i = 0; i < totalFrames; i++) {
      const t = i / TARGET_FPS;
      const currentAmp = sampleWaveformAtTime(wf, t);
      const amp = smoothingAlpha * currentAmp + (1 - smoothingAlpha) * prevAmp;
      prevAmp = amp;

      drawWaveform(amp, i);

      ctx.fillStyle = keyColor.canvas;
      ctx.fillRect(0, 0, canvasW, canvasH);
      ctx.drawImage(waveCanvas, waveOx, waveOy);
      drawTitle(t);

      const imageData = ctx.getImageData(0, 0, canvasW, canvasH);
      frameBuffer.set(imageData.data);
      await writeFrameSync(stdin, frameBuffer);
    }
  });
}

function asNumber(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function asOptionalString(v: unknown): string | undefined {
  if (typeof v === "string" && v.length > 0) return v;
  return undefined;
}

function asOptionalNumber(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Worker video job: encode audio + image into outPath using params from the job payload.
 */
export async function runVideoJob(opts: {
  workDir: string;
  audioPath: string;
  imagePath: string;
  outPath: string;
  params: Record<string, unknown>;
  tools?: Partial<VideoGenTools>;
}): Promise<string> {
  const { workDir, audioPath, imagePath, outPath, params } = opts;
  return generateVideoToPath({
    imagePath,
    audioPath,
    outPath,
    workDir,
    x: asNumber(params.x, 0.5),
    y: asNumber(params.y, 0.5),
    width: asNumber(params.width, 0.8),
    amplitude: asNumber(params.amplitude, 1),
    style: asOptionalString(params.style),
    strokeWidth: asOptionalNumber(params.strokeWidth),
    smoothing: asOptionalNumber(params.smoothing),
    resolution: asOptionalString(params.resolution),
    orientation: asOptionalString(params.orientation),
    waveformType: asOptionalString(params.waveformType),
    color: asOptionalString(params.color),
    chapterTitle: parseChapterTitleLayout(params.chapterTitle),
    chapters: parseVideoChapters(params.chapters),
    episodeTitle: asOptionalString(params.episodeTitle)?.trim() || undefined,
    tools: opts.tools,
  });
}
