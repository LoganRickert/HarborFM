import { execFile } from "child_process";
import { promisify } from "util";

const exec = promisify(execFile);

/** Probe audio duration in seconds via ffprobe. */
export async function probeAudioDurationSec(
  filePath: string,
  ffprobePath: string,
): Promise<number> {
  const { stdout } = await exec(
    ffprobePath,
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
  return durationSec;
}
