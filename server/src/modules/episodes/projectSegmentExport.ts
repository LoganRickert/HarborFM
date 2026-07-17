import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { createHash } from "crypto";
import { join } from "path";
import { tmpdir } from "os";
import { ZipArchive } from "archiver";
import { APP_NAME } from "../../config.js";
import { resolveDataPath } from "../../services/paths.js";
import { waveformPath } from "../segments/utils.js";
import * as episodeRepo from "./repo.js";
import {
  listSegmentsForEpisode,
  type SegmentListRow,
} from "../segments/repo.js";
import { getById as getLibraryAsset } from "../library/repo.js";
import { getPodcastTitle } from "../audio/repo.js";
import { PROJECT_FORMAT_VERSION } from "./projectExport.js";
import {
  findMultitrackDir,
  packSegmentIntoDir,
} from "./projectSegmentPack.js";
import { segmentProjectZipReadmeMarkdown } from "./projectReadme.js";

const CACHE_DIR = join(tmpdir(), "harborfm-segment-project-exports");

export type SegmentProjectExportResult = {
  zipPath: string;
  filename: string;
  fromCache: boolean;
};

function ensureCacheDir(): void {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
}

/** Safe Content-Disposition filename part: strip path/control/URL-unsafe chars. */
function safeFilenamePart(raw: string, fallback: string): string {
  const cleaned =
    raw
      .split("")
      .filter((ch) => {
        const code = ch.charCodeAt(0);
        return code >= 32 && code !== 127;
      })
      .join("")
      // Path separators, Windows-reserved, and URL/query-unsafe (# % ? & etc.).
      .replace(/[\\/:*?"<>|#%?&{}[\]=+;@!,`'^~]+/g, "-")
      .replace(/\s+/g, " ")
      .replace(/-+/g, "-")
      .replace(/^[.\s-]+|[.\s-]+$/g, "")
      .trim() || fallback;
  return cleaned.slice(0, 80);
}

export function segmentZipFilename(
  segmentName: string,
  episodeTitle: string,
  podcastTitle: string,
): string {
  const segment = safeFilenamePart(segmentName, "Segment");
  const episodeName = safeFilenamePart(episodeTitle, "Episode");
  const podcastName = safeFilenamePart(podcastTitle, "Podcast");
  const whiteLabel = safeFilenamePart(APP_NAME, "HarborFM");
  return `${segment}_${episodeName}_${podcastName}_${whiteLabel}-segment.zip`;
}

function fileMtimeMs(path: string | null | undefined): number {
  if (!path || !existsSync(path)) return 0;
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

function fingerprintSegment(
  podcastId: string,
  episodeId: string,
  seg: SegmentListRow,
): string {
  const parts: string[] = [
    seg.id,
    String(seg.position),
    seg.type,
    seg.name ?? "",
    seg.audioPath ?? "",
    seg.reusableAssetId ?? "",
    String(seg.durationSec),
    seg.trimRanges ?? "",
    seg.markers ?? "",
    seg.audioEq ?? "",
    String(seg.disabled),
    seg.createdAt,
  ];
  if (seg.audioPath) {
    const abs = resolveDataPath(seg.audioPath);
    parts.push(String(fileMtimeMs(abs)));
    parts.push(String(fileMtimeMs(waveformPath(abs))));
  }
  if (seg.reusableAssetId) {
    const asset = getLibraryAsset(seg.reusableAssetId);
    if (asset?.audioPath) {
      parts.push(String(fileMtimeMs(resolveDataPath(asset.audioPath))));
    }
  }
  const mt = findMultitrackDir(podcastId, episodeId, seg.id);
  if (mt) {
    parts.push(mt);
    for (const name of readdirSync(mt)) {
      parts.push(name, String(fileMtimeMs(join(mt, name))));
    }
  }
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16);
}

function deleteOlderCaches(segmentId: string, keepHash: string): void {
  if (!existsSync(CACHE_DIR)) return;
  const prefix = `${segmentId}-`;
  const keepName = `${segmentId}-${keepHash}.zip`;
  for (const name of readdirSync(CACHE_DIR)) {
    if (!name.startsWith(prefix) || !name.endsWith(".zip")) continue;
    if (name === keepName) continue;
    try {
      unlinkSync(join(CACHE_DIR, name));
    } catch {
      // best-effort
    }
  }
}

async function buildSegmentZipToPath(
  podcastId: string,
  episodeId: string,
  seg: SegmentListRow,
  destZipPath: string,
): Promise<void> {
  const episode = episodeRepo.getById(episodeId);
  if (!episode) throw new Error("Episode not found");

  const staging = join(
    tmpdir(),
    `harborfm-segment-project-build-${seg.id}-${Date.now()}`,
  );
  mkdirSync(staging, { recursive: true });

  try {
    const manifest = {
      formatVersion: PROJECT_FORMAT_VERSION,
      kind: "segment" as const,
      exportedAt: new Date().toISOString(),
      app: APP_NAME,
      source: {
        podcastId,
        episodeId,
        segmentId: seg.id,
        name: seg.name,
        episodeTitle: episode.title,
      },
    };
    writeFileSync(
      join(staging, "harborfm-project.json"),
      JSON.stringify(manifest, null, 2),
    );
    writeFileSync(
      join(staging, "README.md"),
      segmentProjectZipReadmeMarkdown(PROJECT_FORMAT_VERSION),
    );

    const segDir = join(staging, "segment");
    const libraryRoot = join(staging, "library");
    await packSegmentIntoDir(segDir, podcastId, episodeId, seg, {
      includeLibraryDir: seg.reusableAssetId ? libraryRoot : undefined,
    });

    const partial = `${destZipPath}.partial`;
    if (existsSync(partial)) unlinkSync(partial);
    const output = createWriteStream(partial);
    const archive = new ZipArchive({ zlib: { level: 6 } });
    const done = new Promise<void>((resolve, reject) => {
      output.on("close", () => resolve());
      output.on("error", reject);
      archive.on("error", reject);
    });
    archive.pipe(output);
    archive.directory(staging, false);
    await archive.finalize();
    await done;
    renameSync(partial, destZipPath);
  } finally {
    try {
      rmSync(staging, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
}

export type SegmentProjectExportStatus = "idle" | "building" | "ready" | "failed";

const exportStatusBySegment = new Map<string, "building" | "ready" | "failed">();
const exportErrorBySegment = new Map<string, string>();
const inFlightBySegment = new Map<string, Promise<SegmentProjectExportResult>>();

/**
 * Return a cached or freshly built segment project zip.
 * Concurrent callers for the same segment share one in-flight build.
 */
export async function getOrBuildSegmentProjectZip(
  episodeId: string,
  podcastId: string,
  segmentId: string,
): Promise<SegmentProjectExportResult> {
  const existing = inFlightBySegment.get(segmentId);
  if (existing) return existing;

  const promise = (async (): Promise<SegmentProjectExportResult> => {
    const episode = episodeRepo.getById(episodeId);
    if (!episode) throw new Error("Episode not found");
    const seg = listSegmentsForEpisode(episodeId).find((s) => s.id === segmentId);
    if (!seg) throw new Error("Segment not found");

    const hash = fingerprintSegment(podcastId, episodeId, seg);
    ensureCacheDir();
    const cachedPath = join(CACHE_DIR, `${segmentId}-${hash}.zip`);
    const podcastTitle = getPodcastTitle(podcastId) || "Podcast";
    const filename = segmentZipFilename(
      seg.name || "Segment",
      episode.title || "Episode",
      podcastTitle,
    );

    if (existsSync(cachedPath) && statSync(cachedPath).size > 0) {
      deleteOlderCaches(segmentId, hash);
      return { zipPath: cachedPath, filename, fromCache: true };
    }

    const tmpOut = join(CACHE_DIR, `${segmentId}-${hash}.building.zip`);
    try {
      if (existsSync(tmpOut)) unlinkSync(tmpOut);
    } catch {
      // ignore
    }
    await buildSegmentZipToPath(podcastId, episodeId, seg, tmpOut);
    renameSync(tmpOut, cachedPath);
    deleteOlderCaches(segmentId, hash);
    return { zipPath: cachedPath, filename, fromCache: false };
  })();

  inFlightBySegment.set(segmentId, promise);
  try {
    return await promise;
  } finally {
    if (inFlightBySegment.get(segmentId) === promise) {
      inFlightBySegment.delete(segmentId);
    }
  }
}

/**
 * Start a background segment project zip build. Returns false if already building.
 * Poll getSegmentProjectExportStatus until ready or failed.
 */
export function startSegmentProjectExport(
  episodeId: string,
  podcastId: string,
  segmentId: string,
): boolean {
  const current = exportStatusBySegment.get(segmentId);
  if (current === "building") return false;
  if (current === "ready") return true;
  exportStatusBySegment.set(segmentId, "building");
  exportErrorBySegment.delete(segmentId);
  setImmediate(() => {
    void getOrBuildSegmentProjectZip(episodeId, podcastId, segmentId)
      .then(() => {
        exportStatusBySegment.set(segmentId, "ready");
      })
      .catch((err: unknown) => {
        exportStatusBySegment.set(segmentId, "failed");
        exportErrorBySegment.set(
          segmentId,
          err instanceof Error ? err.message : "Failed to export project",
        );
      });
  });
  return true;
}

/** Status for prepare/poll. Clears ready/failed on read (like transcript). */
export function getSegmentProjectExportStatus(segmentId: string): {
  status: SegmentProjectExportStatus;
  error?: string;
} {
  const status = exportStatusBySegment.get(segmentId);
  if (!status) return { status: "idle" };
  if (status === "building") return { status: "building" };
  const error = exportErrorBySegment.get(segmentId);
  exportStatusBySegment.delete(segmentId);
  exportErrorBySegment.delete(segmentId);
  if (status === "failed") return { status: "failed", error };
  return { status: "ready" };
}
