import { existsSync } from "fs";
import {
  estimateEpisodeVideoBytes,
  generateVideoToPath,
  type VideoGenerationError,
} from "@harborfm/video-gen";
import type {
  VideoOrientation,
  VideoResolution,
  VideoSpectrumStyle,
  VideoWaveformType,
} from "@harborfm/shared";
import {
  AUDIOWAVEFORM_PATH,
  FFMPEG_PATH,
  FFPROBE_PATH,
} from "../config.js";
import {
  getDataDir,
  assertPathUnder,
  assertResolvedPathUnder,
  episodeVideoPath,
  processedDir,
} from "./paths.js";

export { estimateEpisodeVideoBytes };
export type { VideoGenerationError };

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
  /** Integer 1+: for sine/circle = stroke width (px); for bars/dots = bar/dot count. Default 3. */
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
  /** Optional chapter-title overlay layout (center + size, 0–1). */
  chapterTitle?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  /** Chapters for title overlay (from episode finalMarkers). */
  chapters?: Array<{ startTime: number; title: string }>;
}

/**
 * Generate a video from final episode audio and a background image.
 * Paths are sandboxed under the data dir; encode logic lives in @harborfm/video-gen.
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

  const workDir = processedDir(podcastId, episodeId);
  return generateVideoToPath({
    imagePath,
    audioPath,
    outPath,
    workDir,
    x: options.x,
    y: options.y,
    width: options.width,
    amplitude: options.amplitude,
    style: options.style,
    strokeWidth: options.strokeWidth,
    smoothing: options.smoothing,
    resolution: options.resolution,
    orientation: options.orientation,
    waveformType: options.waveformType,
    color: options.color,
    chapterTitle: options.chapterTitle,
    chapters: options.chapters,
    tools: {
      ffmpegPath: FFMPEG_PATH,
      ffprobePath: FFPROBE_PATH,
      audiowaveformPath: AUDIOWAVEFORM_PATH,
    },
  });
}
