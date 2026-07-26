import {
  runVideoJob as runSharedVideoJob,
  type VideoGenerationError,
} from "@harborfm/video-gen";
import {
  AUDIOWAVEFORM_PATH,
  FFMPEG_PATH,
  FFPROBE_PATH,
} from "../config.js";

export type { VideoGenerationError };

/**
 * Worker video job: encode audio + image using shared @harborfm/video-gen.
 */
export async function runVideoJob(opts: {
  workDir: string;
  audioPath: string;
  imagePath: string;
  outPath: string;
  params: Record<string, unknown>;
}): Promise<string> {
  return runSharedVideoJob({
    ...opts,
    tools: {
      ffmpegPath: FFMPEG_PATH,
      ffprobePath: FFPROBE_PATH,
      audiowaveformPath: AUDIOWAVEFORM_PATH,
    },
  });
}
