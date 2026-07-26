import { execFile } from "child_process";
import { renameSync, existsSync } from "fs";
import { extname } from "path";
import { promisify } from "util";
import { FFPROBE_PATH } from "./config.js";

const exec = promisify(execFile);

/** Map ffprobe format_name tokens to a file extension audiowaveform/ffmpeg understand. */
function extFromFormatName(formatName: string): string | null {
  const tokens = formatName
    .toLowerCase()
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const prefer = [
    "mp3",
    "wav",
    "flac",
    "ogg",
    "opus",
    "aac",
    "m4a",
    "mp4",
    "webm",
    "aiff",
    "aif",
  ];
  for (const p of prefer) {
    if (tokens.includes(p)) return p === "aif" ? "aiff" : p;
  }
  if (tokens.some((t) => t.includes("mpeg") || t === "mp3")) return "mp3";
  if (tokens.some((t) => t.includes("matroska"))) return "webm";
  return tokens[0] && /^[a-z0-9]+$/i.test(tokens[0]) ? tokens[0] : null;
}

/**
 * If path has no extension, probe with ffprobe and rename so tools like
 * audiowaveform can detect the container format.
 */
export async function ensureInputHasExtension(path: string): Promise<string> {
  if (extname(path)) return path;
  const { stdout } = await exec(
    FFPROBE_PATH,
    [
      "-v",
      "error",
      "-show_entries",
      "format=format_name",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      path,
    ],
    { maxBuffer: 1024 * 1024 },
  );
  const ext = extFromFormatName(stdout.trim());
  if (!ext) {
    throw new Error(
      `Could not detect media format for ${path} (ffprobe format_name=${JSON.stringify(stdout.trim())})`,
    );
  }
  const withExt = `${path}.${ext}`;
  if (existsSync(withExt)) {
    throw new Error(`Refusing to overwrite existing file: ${withExt}`);
  }
  renameSync(path, withExt);
  return withExt;
}
