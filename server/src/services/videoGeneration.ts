import { spawn } from "child_process";
import { existsSync } from "fs";
import type { Writable } from "stream";
import {
  getDataDir,
  assertPathUnder,
  assertResolvedPathUnder,
  episodeVideoPath,
  processedDir,
} from "./paths.js";
import { FFMPEG_PATH } from "../config.js";
import type { VideoSpectrumStyle, VideoResolution, VideoOrientation, VideoWaveformType } from "@harborfm/shared";
import { probeAudio, generateWaveformDataForVideo, type WaveformDataForVideo } from "./audio.js";

/** Timeout for video generation (long episodes). On timeout the process is killed. */
const VIDEO_GEN_TIMEOUT_MS = 30 * 60 * 1000;

/** Max chars of stderr to include in user-facing message (last portion). */
const STDERR_TAIL_CHARS = 800;

/** Max chars to keep in memory while accumulating stderr (avoids unbounded growth on long encodes). */
const MAX_STDERR_CAPTURE = 8000;

/** Max chars to keep in memory while accumulating stdout. */
const MAX_STDOUT_CAPTURE = 2000;

/** Error with optional FFmpeg stderr for server-side logging. */
export interface VideoGenerationError extends Error {
  ffmpegStderr?: string;
}

/** Take the last N chars of stderr; strip leading newlines and truncate. */
function stderrTail(stderr: string, maxChars: number): string {
  const trimmed = stderr.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return trimmed.slice(-maxChars).replace(/^[^\n]*\n?/, "");
}

/** Resolution to dimensions (width, height) for 16:9 landscape. Portrait swaps. */
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

/** Parse a CSS color string to approximate brightness 0–1. Handles #RGB, #RRGGBB, rgb(r,g,b), rgba(r,g,b,a). */
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

export interface GenerateVideoOptions {
  /** Background image path (absolute). Must be under data dir. */
  imagePath: string;
  /** Final episode audio path (absolute). Must be under data dir. */
  audioPath: string;
  /** X position for waveform overlay, 0–1 (0=left, 0.5=center, 1=right). */
  x: number;
  /** Y position for waveform overlay, 0–1 (0=top, 0.5=center, 1=bottom). */
  y: number;
  /** Width of waveform overlay, 0–1 (fraction of video width). Mapped to pixels here. */
  width: number;
  /** Amplitude scale 0–2. Applied to waveform strip height. */
  amplitude: number;
  /** Waveform line color style (API keeps spectrum-style enum names). Optional when color is set. */
  style?: VideoSpectrumStyle;
  /** Integer 1–30: for sine/circle = stroke width (px); for bars/dots = bar/dot count. Default 3. */
  strokeWidth?: number;
  /** Smoothing 0–1: 0 = instant, 1 = very smooth/slow (EMA). Default 0.7. */
  smoothing?: number;
  /** Output resolution. Optional; default 720p. */
  resolution?: VideoResolution;
  /** Output orientation. Optional; default landscape. */
  orientation?: VideoOrientation;
  /** Waveform type: sine, bars, circle, dots. Optional; default sine. */
  waveformType?: VideoWaveformType;
  /** Waveform color as hex (e.g. #ffffff). Optional; overrides style when set. */
  color?: string;
}

/**
 * Run FFmpeg with stdin pipe; caller writes frames then ends stdin. Resolves with outPath, rejects with VideoGenerationError.
 */
function runFfmpegWithStdin(
  args: string[],
  outPath: string,
  writeFrames: (stdin: Writable) => Promise<void>,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG_PATH, args, {
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
  const t = Math.max(1, Math.min(8, Math.round(thickness)));
  return Math.max(2, Math.min(24, t * 3));
}

/** Smoothing 0–1 -> EMA alpha (higher smoothing = lower alpha = slower change). */
function smoothingToAlpha(smoothing: number): number {
  return Math.max(0.05, Math.min(0.95, 1 - smoothing));
}

/**
 * Generate a video from final episode audio and a background image, with a
 * waveform (amplitude-over-time) overlaid at (x, y). Waveform is drawn with
 * node-canvas from audiowaveform data and piped to FFmpeg. Output is written
 * to processedDir(podcastId, episodeId)/video.mp4.
 */
export async function generateEpisodeVideo(
  podcastId: string,
  episodeId: string,
  options: GenerateVideoOptions,
): Promise<string> {
  const dataDir = getDataDir();
  const outPath = episodeVideoPath(podcastId, episodeId);
  assertResolvedPathUnder(outPath, dataDir);

  const imagePath = assertPathUnder(options.imagePath, dataDir);
  const audioPath = assertPathUnder(options.audioPath, dataDir);
  if (!existsSync(imagePath)) {
    throw new Error("Background image not found. Upload a video cover photo first.");
  }
  if (!existsSync(audioPath)) {
    throw new Error("Final audio file not found. Build the final episode first.");
  }

  const procDir = processedDir(podcastId, episodeId);
  const probe = await probeAudio(audioPath, procDir);
  const durationSec = Math.max(1, probe.durationSec);

  const { width: VIDEO_WIDTH, height: VIDEO_HEIGHT } = resolutionToDimensions(
    options.resolution,
    options.orientation,
  );
  const thicknessParam = Math.max(1, Math.min(30, Math.round(options.strokeWidth ?? 3)));
  const strokeWidthPx = strokeWidthToPx(thicknessParam);
  const barCount = Math.max(1, Math.min(30, thicknessParam));
  const dotCount = Math.max(1, Math.min(30, thicknessParam));
  const smoothingAlpha = smoothingToAlpha(options.smoothing ?? 0.7);
  const lineColor =
    options.color !== undefined && options.color !== ""
      ? String(options.color)
      : waveformLineColor(options.style ?? "spectrum-rainbow");
  const keyColor = keyColorForLineColor(lineColor);
  const waveformType = options.waveformType ?? "sine";
  const vizHeight = Math.max(
    1,
    Math.min(VIDEO_HEIGHT, Math.round(VIDEO_HEIGHT * options.amplitude * AMPLITUDE_TO_HEIGHT_FRACTION)),
  );
  const w = Math.max(1, Math.min(VIDEO_WIDTH, Math.round(Number(options.width) * VIDEO_WIDTH)));
  const xNum = Number(options.x);
  const yNum = Number(options.y);
  const centerPxX = Number.isFinite(xNum) ? xNum * VIDEO_WIDTH : VIDEO_WIDTH / 2;
  const centerPxY = Number.isFinite(yNum) ? yNum * VIDEO_HEIGHT : VIDEO_HEIGHT / 2;
  const xPx = Math.round(centerPxX - w / 2);
  const x = Math.max(0, Math.min(xPx, VIDEO_WIDTH - w));
  const yPx = Math.round(centerPxY - vizHeight / 2);
  const y = Math.max(0, Math.min(yPx, VIDEO_HEIGHT - vizHeight));

  const wf = await generateWaveformDataForVideo(audioPath, procDir, { pixelsPerSecond: TARGET_FPS });
  const totalFrames = Math.ceil(durationSec * TARGET_FPS);
  const maxAmplitudeInData = getMaxAmplitudeFromWaveform(wf);
  const { createCanvas } = await import("canvas");
  const canvas = createCanvas(w, vizHeight);
  const ctx = canvas.getContext("2d");
  const halfH = vizHeight / 2;
  const ampScale = halfH / Math.max(maxAmplitudeInData, 0.05);
  /** Amplitude scaled to [0, halfH]; max loudness maps to full strip height. */
  const effectiveAmp = (amp: number) => amp * ampScale;

  let prevAmp = 0;

  const filterComplex = [
    `[0:v]scale=${VIDEO_WIDTH}:${VIDEO_HEIGHT}:force_original_aspect_ratio=decrease,` +
      `pad=${VIDEO_WIDTH}:${VIDEO_HEIGHT}:(ow-iw)/2:(oh-ih)/2[bg]`,
    `[1:v]colorkey=${keyColor.ffmpeg}:0.01:0.0[viz]`,
    `[bg][viz]overlay=${x}:${y}[outv]`,
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
    `${w}x${vizHeight}`,
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

  const drawFrame = (amp: number, frameIndex: number) => {
    ctx.fillStyle = keyColor.canvas;
    ctx.fillRect(0, 0, w, vizHeight);
    ctx.strokeStyle = lineColor;
    ctx.fillStyle = lineColor;
    ctx.lineWidth = strokeWidthPx;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    const eff = effectiveAmp(amp);
    const phaseOffset = frameIndex * WAVEFORM_ENTROPY_SPEED;
    switch (waveformType) {
      case "sine": {
        ctx.beginPath();
        ctx.moveTo(0.5, halfH + eff * Math.sin(phaseOffset));
        for (let xi = 1; xi <= w; xi++) {
          const yy =
            halfH + eff * Math.sin((2 * Math.PI * WAVEFORM_COSINE_CYCLES * xi) / w + phaseOffset);
          ctx.lineTo(xi + 0.5, yy);
        }
        ctx.stroke();
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
          ctx.fillRect(bx, by, barWidth, barH);
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
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
        ctx.stroke();
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
          ctx.beginPath();
          ctx.arc(dx, centerY, r, 0, 2 * Math.PI);
          ctx.fill();
        }
        break;
      }
      default: {
        ctx.beginPath();
        ctx.moveTo(0.5, halfH + eff * Math.sin(phaseOffset));
        for (let xi = 1; xi <= w; xi++) {
          const yy =
            halfH + eff * Math.sin((2 * Math.PI * WAVEFORM_COSINE_CYCLES * xi) / w + phaseOffset);
          ctx.lineTo(xi + 0.5, yy);
        }
        ctx.stroke();
      }
    }
  };

  const frameBuffer = Buffer.alloc(w * vizHeight * 4);

  return runFfmpegWithStdin(args, outPath, async (stdin) => {
    for (let i = 0; i < totalFrames; i++) {
      const t = i / TARGET_FPS;
      const currentAmp = sampleWaveformAtTime(wf, t);
      const amp = smoothingAlpha * currentAmp + (1 - smoothingAlpha) * prevAmp;
      prevAmp = amp;

      drawFrame(amp, i);

      const imageData = ctx.getImageData(0, 0, w, vizHeight);
      frameBuffer.set(imageData.data);
      await writeFrameSync(stdin, frameBuffer);
    }
  });
}
