import { basename, join } from "path";
import {
  existsSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { nanoid } from "nanoid";
import { readSettings } from "../modules/settings/repo.js";
import {
  dispatchComputeJob,
  resolveWorkerJobSubject,
  workerApiBaseFromSettings,
} from "../modules/workers/index.js";
import type { JobFileRef } from "../modules/workers/jobs.js";
import {
  remakeMixFromMultitrackDir,
  type MultitrackManifest,
  type MultitrackSegmentEntry,
} from "./multitrackRemake.js";
import * as audioService from "./audio.js";

function clipBasename(entry: MultitrackSegmentEntry): string | null {
  const rel = typeof entry.filePath === "string" ? entry.filePath : "";
  if (!rel) return null;
  const base = basename(rel.replace(/\\/g, "/"));
  if (!base || base.includes("..")) return null;
  return base;
}

/**
 * Remake mix via worker when enabled, otherwise locally.
 * Returns duration of the written mix WAV.
 */
export async function remakeMixWithOptionalWorker(opts: {
  podcastId: string;
  episodeId: string;
  segmentId: string;
  mtDir: string;
  remakeManifest: MultitrackManifest;
  mixDest: string;
  allowedBaseDir: string;
  /** Absolute API base including /api. When omitted, uses Settings hostname. */
  apiBase?: string | null;
  userId?: string | null;
}): Promise<{ durationSec: number }> {
  const {
    podcastId,
    episodeId,
    segmentId,
    mtDir,
    remakeManifest,
    mixDest,
    allowedBaseDir,
    userId,
  } = opts;

  const runLocal = async (): Promise<{ durationSec: number }> =>
    remakeMixFromMultitrackDir(
      mtDir,
      remakeManifest,
      mixDest,
      allowedBaseDir,
    );

  const settings = readSettings();
  const apiBase =
    (opts.apiBase && opts.apiBase.trim()) || workerApiBaseFromSettings();
  if (
    !settings.workers_enabled ||
    settings.workers_use_for_segment_remakes === false ||
    !apiBase
  ) {
    return runLocal();
  }

  const segments = Array.isArray(remakeManifest.segments)
    ? remakeManifest.segments
    : [];
  const trackFiles = new Map<string, string>();
  for (const entry of segments) {
    if (entry.muted === true) continue;
    const base = clipBasename(entry);
    if (!base) continue;
    const abs = join(mtDir, base);
    if (!existsSync(abs)) continue;
    trackFiles.set(base, abs);
  }
  if (trackFiles.size === 0) {
    return runLocal();
  }

  const tempManifestPath = join(
    mtDir,
    `.worker_remake_manifest_${nanoid()}.json`,
  );
  writeFileSync(tempManifestPath, JSON.stringify(remakeManifest));

  const inputs: JobFileRef[] = [
    { name: "manifest", absolutePath: tempManifestPath },
  ];
  const tracks: Array<{ input: string; file: string }> = [];
  let i = 0;
  for (const [file, abs] of trackFiles) {
    const input = `track_${i++}`;
    inputs.push({ name: input, absolutePath: abs });
    tracks.push({ input, file });
  }

  try {
    await dispatchComputeJob({
      kind: "segment_remake",
      apiBase,
      inputs,
      outputs: [{ name: "mix.wav", absolutePath: mixDest }],
      params: { tracks },
      subject: resolveWorkerJobSubject({
        podcastId,
        episodeId,
        segmentId,
        userId: userId ?? null,
      }),
      runLocal: async () => {
        await runLocal();
      },
    });
  } finally {
    try {
      unlinkSync(tempManifestPath);
    } catch {
      /* ignore */
    }
  }

  if (!existsSync(mixDest)) {
    throw new Error("Segment remake produced no output");
  }
  const probe = await audioService.probeAudio(mixDest, allowedBaseDir);
  return { durationSec: probe.durationSec };
}
