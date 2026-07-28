/**
 * Server wrapper around @harborfm/segment-remake.
 * Enforces path sandboxing and injects configured ffmpeg/ffprobe.
 */
import { FFMPEG_PATH, FFPROBE_PATH } from "../config.js";
import { assertPathUnder, assertResolvedPathUnder } from "./paths.js";
import {
  remakeMixFromMultitrackDir as remakeMixFromMultitrackDirCore,
  trimOverlappingSoundboardEntries,
  pruneMarkersForDuration,
  pruneTrimRangesForDuration,
  type MultitrackEqBand,
  type MultitrackGateParams,
  type MultitrackCompParams,
  type MultitrackSegmentEntry,
  type MultitrackManifest,
} from "@harborfm/segment-remake";

export type {
  MultitrackEqBand,
  MultitrackGateParams,
  MultitrackCompParams,
  MultitrackSegmentEntry,
  MultitrackManifest,
};

export {
  trimOverlappingSoundboardEntries,
  pruneMarkersForDuration,
  pruneTrimRangesForDuration,
};

/**
 * Remake the segment mix WAV from multitrack MP3s + tracks_manifest
 * (same loudnorm/amix rules as webrtc RecordingManager.runAmixAndDeliver).
 */
export async function remakeMixFromMultitrackDir(
  mtDir: string,
  manifest: MultitrackManifest,
  outWavPath: string,
  allowedBaseDir: string,
): Promise<{ durationSec: number }> {
  assertPathUnder(mtDir, allowedBaseDir);
  assertResolvedPathUnder(outWavPath, allowedBaseDir);
  return remakeMixFromMultitrackDirCore(mtDir, manifest, outWavPath, {
    ffmpegPath: FFMPEG_PATH,
    ffprobePath: FFPROBE_PATH,
  });
}
