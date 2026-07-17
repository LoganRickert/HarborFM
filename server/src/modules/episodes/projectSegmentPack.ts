import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "fs";
import { basename, dirname, extname, join } from "path";
import { resolveDataPath, uploadsDir } from "../../services/paths.js";
import { sha256FileSync } from "../../utils/hash.js";
import * as audioService from "../../services/audio.js";
import { waveformPath } from "../segments/utils.js";
import { getById as getLibraryAsset } from "../library/repo.js";
import type { SegmentListRow } from "../segments/repo.js";
import {
  listRecordingRelPaths,
  writeSegmentDawSidecars,
} from "./projectDawSidecars.js";

/** Find multitrack dir for a segment (segmentId or YYYYMMDD_HHMMSS_segmentId). */
export function findMultitrackDir(
  podcastId: string,
  episodeId: string,
  segmentId: string,
): string | null {
  const base = join(uploadsDir(podcastId, episodeId), "recordings");
  if (!existsSync(base)) return null;
  const names = readdirSync(base);
  const match = names.find((n) => n === segmentId || n.endsWith(`_${segmentId}`));
  return match ? join(base, match) : null;
}

function parseJsonField(raw: string | null | undefined): unknown {
  if (raw == null || !String(raw).trim()) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export type PackedSegmentResult = {
  audioFile: string | null;
  audioSha256: string | null;
  waveformSha256: string | null;
  hasRecordings: boolean;
  libraryAssetId: string | null;
  /** Relative recording paths under segDir (recordings/foo.mp3), if any. */
  recordingFiles: string[];
};

/**
 * Pack one segment's files into segDir (segment.json, audio.*, waveform, recordings/).
 * Optionally also write library/<assetId>/ when includeLibraryDir is set and segment is reusable.
 */
export async function packSegmentIntoDir(
  segDir: string,
  podcastId: string,
  episodeId: string,
  seg: SegmentListRow,
  opts?: { includeLibraryDir?: string },
): Promise<PackedSegmentResult> {
  mkdirSync(segDir, { recursive: true });

  let audioAbs: string | null = null;
  if (seg.type === "recorded" && seg.audioPath) {
    audioAbs = resolveDataPath(seg.audioPath);
  } else if (seg.type === "reusable" && seg.reusableAssetId) {
    const asset = getLibraryAsset(seg.reusableAssetId);
    if (asset?.audioPath) audioAbs = resolveDataPath(asset.audioPath);
  }

  let audioFile: string | null = null;
  let audioSha256: string | null = null;
  let waveformSha256: string | null = null;
  let audioSource: "recorded" | "library" | null = null;

  if (audioAbs && existsSync(audioAbs)) {
    const ext = extname(audioAbs) || ".mp3";
    const audioName = `audio${ext}`;
    copyFileSync(audioAbs, join(segDir, audioName));
    audioFile = audioName;
    audioSource = seg.type === "reusable" ? "library" : "recorded";
    audioSha256 = sha256FileSync(join(segDir, audioName));
    let wav = waveformPath(audioAbs);
    if (!existsSync(wav)) {
      try {
        await audioService.generateWaveformFile(audioAbs, dirname(audioAbs));
        wav = waveformPath(audioAbs);
      } catch {
        // best-effort
      }
    }
    if (existsSync(wav)) {
      copyFileSync(wav, join(segDir, "waveform.json"));
      waveformSha256 = sha256FileSync(join(segDir, "waveform.json"));
    }
  }

  if (opts?.includeLibraryDir && seg.reusableAssetId) {
    const asset = getLibraryAsset(seg.reusableAssetId);
    if (asset) {
      const libDir = join(opts.includeLibraryDir, asset.id);
      mkdirSync(libDir, { recursive: true });
      writeFileSync(
        join(libDir, "asset.json"),
        JSON.stringify(
          {
            originalId: asset.id,
            name: asset.name,
            durationSec: asset.durationSec,
            tag: asset.tag,
            copyright: asset.copyright,
            license: asset.license,
            sourceUrl: asset.sourceUrl,
          },
          null,
          2,
        ),
      );
      if (asset.audioPath) {
        const aAbs = resolveDataPath(asset.audioPath);
        if (existsSync(aAbs)) {
          const ext = extname(aAbs) || ".mp3";
          copyFileSync(aAbs, join(libDir, `audio${ext}`));
        }
      }
    }
  }

  let hasRecordings = false;
  const mtDir = findMultitrackDir(podcastId, episodeId, seg.id);
  if (mtDir && existsSync(mtDir)) {
    const recDir = join(segDir, "recordings");
    mkdirSync(recDir, { recursive: true });
    let manifestObj: Record<string, unknown> | null = null;
    for (const name of readdirSync(mtDir)) {
      const src = join(mtDir, name);
      if (!statSync(src).isFile()) continue;
      if (name === "tracks_manifest.json") {
        try {
          manifestObj = JSON.parse(readFileSync(src, "utf8")) as Record<
            string,
            unknown
          >;
        } catch {
          manifestObj = null;
        }
      } else {
        copyFileSync(src, join(recDir, basename(name)));
      }
    }
    if (manifestObj && Array.isArray(manifestObj.segments)) {
      const enriched: Array<Record<string, unknown>> = [];
      for (const entry of manifestObj.segments as Array<
        Record<string, unknown>
      >) {
        const next = { ...entry };
        const rel = typeof entry.filePath === "string" ? entry.filePath : null;
        const trackBase = rel ? basename(rel.replace(/\\/g, "/")) : null;
        if (trackBase) {
          next.filePath = trackBase;
          const trackAbs = join(recDir, trackBase);
          if (existsSync(trackAbs)) {
            next.fileSha256 = sha256FileSync(trackAbs);
            const trackWav = waveformPath(trackAbs);
            if (!existsSync(trackWav)) {
              try {
                await audioService.generateWaveformFile(trackAbs, recDir);
              } catch {
                // best-effort
              }
            }
            if (existsSync(trackWav)) {
              next.waveformSha256 = sha256FileSync(trackWav);
            }
          }
        }
        enriched.push(next);
      }
      manifestObj.segments = enriched;
    }
    writeFileSync(
      join(recDir, "tracks_manifest.json"),
      JSON.stringify(manifestObj ?? {}, null, 2),
    );
    hasRecordings = true;
  }

  const markers = parseJsonField(seg.markers);
  const trimRanges = parseJsonField(seg.trimRanges);
  await writeSegmentDawSidecars(segDir, {
    audioFile,
    durationSec: Number(seg.durationSec) || 0,
    markers,
    trimRanges,
    timelineName: seg.name || undefined,
  });

  const segmentRppSha256 = sha256FileSync(join(segDir, "segment.rpp"));
  const audacityLofSha256 = sha256FileSync(join(segDir, "audacity.lof"));
  const timelineOtioSha256 = sha256FileSync(join(segDir, "timeline.otio"));

  const segmentJson = {
    originalId: seg.id,
    type: seg.type,
    position: seg.position,
    name: seg.name,
    durationSec: seg.durationSec,
    trimRanges,
    markers,
    audioEq: parseJsonField(seg.audioEq),
    disabled: seg.disabled,
    reusableAssetId: seg.reusableAssetId,
    audioFile,
    audioSource,
    hasRecordings,
    hasWaveform: existsSync(join(segDir, "waveform.json")),
    audioSha256,
    waveformSha256,
    segmentRppSha256,
    audacityLofSha256,
    timelineOtioSha256,
  };
  writeFileSync(join(segDir, "segment.json"), JSON.stringify(segmentJson, null, 2));

  return {
    audioFile,
    audioSha256,
    waveformSha256,
    hasRecordings,
    libraryAssetId: seg.reusableAssetId,
    recordingFiles: listRecordingRelPaths(segDir),
  };
}
