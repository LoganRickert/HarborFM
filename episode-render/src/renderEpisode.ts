import { execFile } from "child_process";
import { existsSync, mkdirSync, unlinkSync } from "fs";
import { dirname, join } from "path";
import { promisify } from "util";
import { randomUUID } from "crypto";

const exec = promisify(execFile);

/** Default loudness target (LUFS). 0 disables loudnorm. */
export const DEFAULT_LOUDNESS_TARGET_LUFS = -16;

export type FinalAudioFormat = "mp3" | "m4a";
export type FinalAudioChannels = "mono" | "stereo";

export type EpisodeRenderTools = {
  ffmpegPath: string;
  ffprobePath: string;
};

export function resolveEpisodeRenderTools(
  partial?: Partial<EpisodeRenderTools>,
): EpisodeRenderTools {
  return {
    ffmpegPath: partial?.ffmpegPath?.trim() || "ffmpeg",
    ffprobePath: partial?.ffprobePath?.trim() || "ffprobe",
  };
}

export type AudioEqOptions = {
  lowDb?: number;
  midDb?: number;
  highDb?: number;
};

export type EpisodeRenderSegment = {
  /** Absolute path to the segment mix (downloaded or on disk). */
  inputPath: string;
  /** Soft-trim ranges to exclude (seconds). Null/empty = keep full file. */
  trimRanges: Array<[number, number]> | null;
  /** Optional 3-band EQ. Null or all-zero = skip. */
  audioEq: AudioEqOptions | null;
};

export type EpisodeRenderJobOpts = {
  /** Working directory for temp WAV files (must be writable). */
  workDir: string;
  segments: EpisodeRenderSegment[];
  outPath: string;
  format: FinalAudioFormat;
  bitrateKbps: number;
  channels: FinalAudioChannels;
  loudnessTargetLufs?: number | null;
  tools?: Partial<EpisodeRenderTools>;
};

async function probeDurationSec(
  filePath: string,
  tools: EpisodeRenderTools,
): Promise<number> {
  const { stdout } = await exec(
    tools.ffprobePath,
    [
      "-v",
      "quiet",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      filePath,
    ],
    { maxBuffer: 2 * 1024 * 1024 },
  );
  const info = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: Array<{ duration?: string; codec_type?: string }>;
  };
  let durationSec = parseFloat(info.format?.duration ?? "0");
  if ((!Number.isFinite(durationSec) || durationSec <= 0) && info.streams) {
    const audio = info.streams.find((s) => s.codec_type === "audio");
    if (audio?.duration) {
      const d = parseFloat(audio.duration);
      if (Number.isFinite(d) && d > 0) durationSec = d;
    }
  }
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new Error(`Could not probe duration for ${filePath}`);
  }
  return durationSec;
}

async function removeRangesAndExportToWav(
  sourcePath: string,
  excludeRanges: Array<[number, number]>,
  outputPath: string,
  tools: EpisodeRenderTools,
): Promise<void> {
  const totalDurationSec = await probeDurationSec(sourcePath, tools);

  if (excludeRanges.length === 0) {
    await exec(
      tools.ffmpegPath,
      [
        "-i",
        sourcePath,
        "-acodec",
        "pcm_s16le",
        "-ar",
        "44100",
        "-y",
        outputPath,
      ],
      { maxBuffer: 1024 * 1024 },
    );
    return;
  }

  const sorted = [...excludeRanges].sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const [start, end] of sorted) {
    if (start >= totalDurationSec || end <= 0) continue;
    const clampedStart = Math.max(0, start);
    const clampedEnd = Math.min(totalDurationSec, end);
    if (clampedStart >= clampedEnd) continue;
    const last = merged[merged.length - 1];
    if (last && clampedStart <= last[1]) {
      last[1] = Math.max(last[1], clampedEnd);
    } else {
      merged.push([clampedStart, clampedEnd]);
    }
  }

  const keep: Array<{ start: number; end: number }> = [];
  let pos = 0;
  for (const [rStart, rEnd] of merged) {
    if (rStart > pos) keep.push({ start: pos, end: rStart });
    pos = rEnd;
  }
  if (pos < totalDurationSec) keep.push({ start: pos, end: totalDurationSec });
  if (keep.length === 0) {
    throw new Error("Cannot remove entire audio file");
  }

  const tempDir = dirname(outputPath);
  const tempFiles: string[] = [];
  try {
    for (const seg of keep) {
      const path = join(tempDir, `temp_${randomUUID()}.wav`);
      tempFiles.push(path);
      await exec(
        tools.ffmpegPath,
        [
          "-ss",
          String(seg.start),
          "-i",
          sourcePath,
          "-t",
          String(seg.end - seg.start),
          "-acodec",
          "pcm_s16le",
          "-ar",
          "44100",
          "-y",
          path,
        ],
        { maxBuffer: 1024 * 1024 },
      );
    }

    const n = tempFiles.length;
    const filter =
      tempFiles.map((_, i) => `[${i}:a]`).join("") +
      `concat=n=${n}:v=0:a=1[out]`;
    const args = tempFiles
      .flatMap((p) => ["-i", p])
      .concat([
        "-filter_complex",
        filter,
        "-map",
        "[out]",
        "-acodec",
        "pcm_s16le",
        "-ar",
        "44100",
        "-y",
        outputPath,
      ]);
    await exec(tools.ffmpegPath, args, { maxBuffer: 1024 * 1024 });
  } finally {
    for (const tempFile of tempFiles) {
      try {
        unlinkSync(tempFile);
      } catch {
        /* ignore */
      }
    }
  }
}

async function applyEqToWav(
  inputPath: string,
  outputPath: string,
  options: AudioEqOptions,
  tools: EpisodeRenderTools,
): Promise<void> {
  const low = options.lowDb ?? 0;
  const mid = options.midDb ?? 0;
  const high = options.highDb ?? 0;
  const parts: string[] = [];
  if (low !== 0) parts.push(`bass=g=${low}`);
  if (mid !== 0) parts.push("equalizer=f=1000:t=q:w=1:g=" + mid);
  if (high !== 0) parts.push(`treble=g=${high}`);

  if (parts.length === 0) {
    await exec(
      tools.ffmpegPath,
      [
        "-i",
        inputPath,
        "-acodec",
        "pcm_s16le",
        "-ar",
        "44100",
        "-y",
        outputPath,
      ],
      { maxBuffer: 1024 * 1024 },
    );
    return;
  }

  const af = parts.join(",");
  await exec(
    tools.ffmpegPath,
    [
      "-i",
      inputPath,
      "-af",
      af,
      "-acodec",
      "pcm_s16le",
      "-ar",
      "44100",
      "-y",
      outputPath,
    ],
    { maxBuffer: 1024 * 1024 },
  );
}

async function concatToFinal(
  segmentPaths: string[],
  outputPath: string,
  opts: {
    format: FinalAudioFormat;
    bitrateKbps: number;
    channels: FinalAudioChannels;
    loudnessTargetLufs?: number | null;
  },
  tools: EpisodeRenderTools,
): Promise<void> {
  if (segmentPaths.length === 0) {
    throw new Error("At least one segment required");
  }
  const n = segmentPaths.length;
  const effectiveLufs =
    opts.loudnessTargetLufs !== undefined && opts.loudnessTargetLufs !== null
      ? opts.loudnessTargetLufs
      : DEFAULT_LOUDNESS_TARGET_LUFS;
  const concatPart =
    segmentPaths.map((_, i) => `[${i}:a]`).join("") + `concat=n=${n}:v=0:a=1`;
  const filter =
    effectiveLufs === 0
      ? concatPart + "[out]"
      : concatPart +
        `[concat];[concat]loudnorm=I=${effectiveLufs}:TP=-1:LRA=14[out]`;
  const channels = opts.channels === "stereo" ? 2 : 1;
  const bitrate = `${Math.max(16, opts.bitrateKbps)}k`;
  const args = segmentPaths
    .flatMap((p) => ["-i", p])
    .concat([
      "-filter_complex",
      filter,
      "-map",
      "[out]",
      "-ac",
      String(channels),
    ]);
  if (opts.format === "m4a") {
    args.push("-c:a", "aac", "-b:a", bitrate, "-movflags", "+faststart");
  } else {
    args.push("-acodec", "libmp3lame", "-b:a", bitrate);
  }
  args.push("-y", outputPath);
  await exec(tools.ffmpegPath, args, { maxBuffer: 1024 * 1024 });
}

/**
 * Soft-trim (optional), EQ (optional), then concat + loudnorm into final.mp3|m4a.
 * Used by both the HarborFM server (local) and compute workers.
 */
export async function runEpisodeRenderJob(
  opts: EpisodeRenderJobOpts,
): Promise<string> {
  const tools = resolveEpisodeRenderTools(opts.tools);
  if (!opts.segments.length) {
    throw new Error("At least one segment required");
  }
  if (!existsSync(opts.workDir)) {
    mkdirSync(opts.workDir, { recursive: true });
  }

  const preparedPaths: string[] = [];
  const tempsToClean: string[] = [];

  try {
    for (let i = 0; i < opts.segments.length; i++) {
      const seg = opts.segments[i]!;
      if (!existsSync(seg.inputPath)) {
        throw new Error(`Missing segment input: ${seg.inputPath}`);
      }

      const ranges = seg.trimRanges?.length ? seg.trimRanges : [];
      let currentPath = seg.inputPath;

      if (ranges.length > 0) {
        const trimPath = join(opts.workDir, `trim_${i}_${randomUUID()}.wav`);
        tempsToClean.push(trimPath);
        await removeRangesAndExportToWav(
          currentPath,
          ranges,
          trimPath,
          tools,
        );
        currentPath = trimPath;
      }

      const eq = seg.audioEq;
      const low = eq?.lowDb ?? 0;
      const mid = eq?.midDb ?? 0;
      const high = eq?.highDb ?? 0;
      if (eq && (low !== 0 || mid !== 0 || high !== 0)) {
        const eqPath = join(opts.workDir, `eq_${i}_${randomUUID()}.wav`);
        tempsToClean.push(eqPath);
        await applyEqToWav(currentPath, eqPath, eq, tools);
        currentPath = eqPath;
      }

      preparedPaths.push(currentPath);
    }

    await concatToFinal(
      preparedPaths,
      opts.outPath,
      {
        format: opts.format,
        bitrateKbps: opts.bitrateKbps,
        channels: opts.channels,
        loudnessTargetLufs: opts.loudnessTargetLufs,
      },
      tools,
    );
    return opts.outPath;
  } finally {
    for (const p of tempsToClean) {
      try {
        unlinkSync(p);
      } catch {
        /* ignore */
      }
    }
  }
}
