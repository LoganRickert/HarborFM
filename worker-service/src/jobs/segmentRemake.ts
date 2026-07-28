import { basename, join } from "path";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "fs";
import {
  remakeMixFromMultitrackDir,
  type MultitrackManifest,
} from "@harborfm/segment-remake";
import { FFMPEG_PATH, FFPROBE_PATH } from "../config.js";

/**
 * Worker multi-track remake: assemble takes + remake manifest, run shared mixer.
 */
export async function runSegmentRemakeWorkerJob(opts: {
  workDir: string;
  inputPaths: Map<string, string>;
  outPath: string;
  params: Record<string, unknown>;
}): Promise<void> {
  const mtDir = join(opts.workDir, "multitrack");
  mkdirSync(mtDir, { recursive: true });

  const manifestRaw = opts.inputPaths.get("manifest");
  if (!manifestRaw || !existsSync(manifestRaw)) {
    throw new Error("segment_remake missing manifest input");
  }
  let manifest: MultitrackManifest;
  try {
    manifest = JSON.parse(
      readFileSync(manifestRaw, "utf8"),
    ) as MultitrackManifest;
  } catch {
    throw new Error("segment_remake manifest is not valid JSON");
  }
  writeFileSync(
    join(mtDir, "tracks_manifest.json"),
    JSON.stringify(manifest, null, 2),
  );

  const tracksRaw = opts.params.tracks;
  if (!Array.isArray(tracksRaw) || tracksRaw.length === 0) {
    throw new Error("segment_remake params.tracks required");
  }
  for (const raw of tracksRaw) {
    if (!raw || typeof raw !== "object") {
      throw new Error("Invalid segment_remake track entry");
    }
    const o = raw as Record<string, unknown>;
    const inputName = typeof o.input === "string" ? o.input : "";
    const file = typeof o.file === "string" ? basename(o.file) : "";
    if (!inputName || !file || file.includes("..")) {
      throw new Error("Invalid segment_remake track mapping");
    }
    const src = opts.inputPaths.get(inputName);
    if (!src || !existsSync(src)) {
      throw new Error(`Missing track input ${inputName}`);
    }
    copyFileSync(src, join(mtDir, file));
  }

  await remakeMixFromMultitrackDir(mtDir, manifest, opts.outPath, {
    ffmpegPath: FFMPEG_PATH,
    ffprobePath: FFPROBE_PATH,
  });
}
