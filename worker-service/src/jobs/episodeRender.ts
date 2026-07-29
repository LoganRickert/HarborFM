import { join } from "path";
import {
  runEpisodeRenderJob,
  type FinalAudioChannels,
  type FinalAudioFormat,
} from "@harborfm/episode-render";
import { FFMPEG_PATH, FFPROBE_PATH } from "../config.js";

function asFormat(v: unknown): FinalAudioFormat {
  return v === "m4a" ? "m4a" : "mp3";
}

function asChannels(v: unknown): FinalAudioChannels {
  return v === "stereo" ? "stereo" : "mono";
}

function asTrimRanges(v: unknown): Array<[number, number]> | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  const out: Array<[number, number]> = [];
  for (const r of v) {
    if (
      Array.isArray(r) &&
      r.length === 2 &&
      typeof r[0] === "number" &&
      typeof r[1] === "number"
    ) {
      out.push([r[0], r[1]]);
    }
  }
  return out.length > 0 ? out : null;
}

function asEq(
  v: unknown,
): { lowDb?: number; midDb?: number; highDb?: number } | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const lowDb = typeof o.lowDb === "number" ? o.lowDb : 0;
  const midDb = typeof o.midDb === "number" ? o.midDb : 0;
  const highDb = typeof o.highDb === "number" ? o.highDb : 0;
  if (lowDb === 0 && midDb === 0 && highDb === 0) return null;
  return { lowDb, midDb, highDb };
}

/**
 * Worker final-episode job: soft-trim, EQ, concat + loudnorm via shared package.
 */
export async function runEpisodeRenderWorkerJob(opts: {
  workDir: string;
  inputPaths: Map<string, string>;
  outPath: string;
  params: Record<string, unknown>;
}): Promise<string> {
  const segmentsRaw = opts.params.segments;
  if (!Array.isArray(segmentsRaw) || segmentsRaw.length === 0) {
    throw new Error("episode_render params.segments required");
  }

  const segments = segmentsRaw.map((raw, i) => {
    if (!raw || typeof raw !== "object") {
      throw new Error(`Invalid segment params at index ${i}`);
    }
    const o = raw as Record<string, unknown>;
    const inputName = typeof o.input === "string" ? o.input : "";
    if (!inputName) throw new Error(`Segment ${i} missing input name`);
    const inputPath = opts.inputPaths.get(inputName);
    if (!inputPath) throw new Error(`Missing input file for ${inputName}`);
    return {
      inputPath,
      trimRanges: asTrimRanges(o.trimRanges),
      audioEq: asEq(o.audioEq),
      loudnessTargetingEnabled: o.loudnessTargetingEnabled !== false,
      finalGainDb:
        typeof o.finalGainDb === "number" && Number.isFinite(o.finalGainDb)
          ? o.finalGainDb
          : 0,
    };
  });

  const loudness =
    opts.params.loudnessTargetLufs === null
      ? null
      : typeof opts.params.loudnessTargetLufs === "number"
        ? opts.params.loudnessTargetLufs
        : undefined;

  return runEpisodeRenderJob({
    workDir: opts.workDir,
    segments,
    outPath: opts.outPath,
    format: asFormat(opts.params.format),
    bitrateKbps:
      typeof opts.params.bitrateKbps === "number"
        ? opts.params.bitrateKbps
        : 128,
    channels: asChannels(opts.params.channels),
    loudnessTargetLufs: loudness,
    tools: {
      ffmpegPath: FFMPEG_PATH,
      ffprobePath: FFPROBE_PATH,
    },
  });
}

export function finalOutputName(format: unknown): string {
  return asFormat(format) === "m4a" ? "final.m4a" : "final.mp3";
}

/** Local path helper for worker client. */
export function episodeRenderOutPath(
  workDir: string,
  format: unknown,
): string {
  return join(workDir, finalOutputName(format));
}
