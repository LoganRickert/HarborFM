import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  copyFileSync,
  rmSync,
} from "fs";
import { createHash } from "crypto";
import { extname, join } from "path";
import { tmpdir } from "os";
import { ZipArchive } from "archiver";
import { APP_NAME, WAVEFORM_EXTENSION } from "../../config.js";
import {
  chaptersJsonPath,
  episodeVideoPath,
  resolveDataPath,
  transcriptSrtPath,
} from "../../services/paths.js";
import { waveformPath } from "../segments/utils.js";
import * as episodeRepo from "./repo.js";
import { listSegmentsForEpisode } from "../segments/repo.js";
import { getById as getLibraryAsset } from "../library/repo.js";
import { getShowNotesForEpisode } from "../showNotes/repo.js";
import { getPollByEpisodeId, rowToDto } from "../polls/repo.js";
import { getPodcastTitle } from "../audio/repo.js";
import { projectZipReadmeMarkdown } from "./projectReadme.js";
import { findMultitrackDir, packSegmentIntoDir } from "./projectSegmentPack.js";

export { findMultitrackDir } from "./projectSegmentPack.js";

export const PROJECT_FORMAT_VERSION = 1;

const CACHE_DIR = join(tmpdir(), "harborfm-project-exports");

export type ProjectExportResult = {
  zipPath: string;
  filename: string;
  fromCache: boolean;
};

function ensureCacheDir(): void {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
}

function safeSegmentFolderName(name: string | null, index: number): string {
  const raw = (name || `segment-${index}`)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);
  const base = raw || `segment-${index}`;
  return `${String(index).padStart(3, "0")}_${base}`;
}

/** Safe Content-Disposition filename part: strip path/control chars. */
function safeFilenamePart(raw: string, fallback: string): string {
  const cleaned =
    raw
      .split("")
      .filter((ch) => {
        const code = ch.charCodeAt(0);
        return code >= 32 && code !== 127;
      })
      .join("")
      .replace(/[\\/:*?"<>|]/g, "-")
      .replace(/\s+/g, " ")
      .trim() || fallback;
  return cleaned.slice(0, 80);
}

export function projectZipFilename(
  episodeTitle: string,
  podcastTitle: string,
): string {
  const episodeName = safeFilenamePart(episodeTitle, "Episode");
  const podcastName = safeFilenamePart(podcastTitle, "Podcast");
  const whiteLabel = safeFilenamePart(APP_NAME, "HarborFM");
  return `${episodeName}_${podcastName}_${whiteLabel}-project.zip`;
}

function fileMtimeMs(path: string | null | undefined): number {
  if (!path || !existsSync(path)) return 0;
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

function fingerprintEpisode(
  episodeId: string,
  podcastId: string,
): string {
  const episode = episodeRepo.getById(episodeId);
  if (!episode) throw new Error("Episode not found");
  const segments = listSegmentsForEpisode(episodeId);
  const parts: string[] = [
    episode.updatedAt,
    episode.audioFinalPath ?? "",
    episode.artworkPath ?? "",
    episode.videoFinalPath ?? "",
    String(segments.length),
  ];
  for (const seg of segments) {
    parts.push(
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
    );
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
  }
  if (episode.audioFinalPath) {
    const finalAbs = resolveDataPath(episode.audioFinalPath);
    parts.push(String(fileMtimeMs(finalAbs)));
    parts.push(String(fileMtimeMs(waveformPath(finalAbs))));
  }
  parts.push(String(fileMtimeMs(transcriptSrtPath(podcastId, episodeId))));
  parts.push(String(fileMtimeMs(chaptersJsonPath(podcastId, episodeId))));
  parts.push(String(fileMtimeMs(episodeVideoPath(podcastId, episodeId))));
  if (episode.artworkPath) {
    parts.push(String(fileMtimeMs(resolveDataPath(episode.artworkPath))));
  }
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16);
}

function deleteOlderCaches(episodeId: string, keepHash: string): void {
  if (!existsSync(CACHE_DIR)) return;
  const prefix = `${episodeId}-`;
  const keepName = `${episodeId}-${keepHash}.zip`;
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

function parseJsonField(raw: string | null | undefined): unknown {
  if (raw == null || !String(raw).trim()) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function buildZipToPath(
  episodeId: string,
  podcastId: string,
  destZipPath: string,
): Promise<void> {
  const episode = episodeRepo.getById(episodeId);
  if (!episode) throw new Error("Episode not found");
  const segments = listSegmentsForEpisode(episodeId);
  const cast = episodeRepo.getEpisodeCast(episodeId);
  const showNotes = getShowNotesForEpisode(episodeId);
  const pollRow = getPollByEpisodeId(episodeId);

  const staging = join(tmpdir(), `harborfm-project-build-${episodeId}-${Date.now()}`);
  mkdirSync(staging, { recursive: true });

  try {
    const manifest = {
      formatVersion: PROJECT_FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      app: APP_NAME,
      source: {
        episodeId,
        podcastId,
        slug: episode.slug,
        title: episode.title,
      },
    };
    writeFileSync(
      join(staging, "harborfm-project.json"),
      JSON.stringify(manifest, null, 2),
    );
    writeFileSync(
      join(staging, "README.md"),
      projectZipReadmeMarkdown(PROJECT_FORMAT_VERSION),
    );

    mkdirSync(join(staging, "episode"), { recursive: true });
    const episodeJson = {
      title: episode.title,
      description: episode.description ?? "",
      subtitle: episode.subtitle,
      summary: episode.summary,
      contentEncoded: episode.contentEncoded,
      seasonNumber: episode.seasonNumber,
      episodeNumber: episode.episodeNumber,
      episodeType: episode.episodeType,
      explicit: episode.explicit,
      episodeLink: episode.episodeLink,
      artworkUrl: episode.artworkUrl,
      subscriberOnly: episode.subscriberOnly,
      showNotesGuestVisible: episode.showNotesGuestVisible,
      finalMarkers: parseJsonField(episode.finalMarkers),
      finalSoundbites: parseJsonField(episode.finalSoundbites),
      contentLinks: parseJsonField(episode.contentLinks),
      podcastTxts: parseJsonField(episode.podcastTxts),
      socialInteracts: parseJsonField(episode.socialInteracts),
      locations: parseJsonField(episode.locations),
      license: episode.license,
      podcastImages: parseJsonField(episode.podcastImages),
      fundingLinks: parseJsonField(episode.fundingLinks),
      chat: parseJsonField(episode.chat),
      valueBlocks: parseJsonField(episode.valueBlocks),
      audioMime: episode.audioMime,
      audioBytes: episode.audioBytes,
      audioDurationSec: episode.audioDurationSec,
      castNames: cast.map((c) => c.name),
      hasArtwork: Boolean(episode.artworkPath),
      hasFinalAudio: Boolean(episode.audioFinalPath),
      hasVideo: Boolean(episode.videoFinalPath),
    };
    writeFileSync(
      join(staging, "episode", "episode.json"),
      JSON.stringify(episodeJson, null, 2),
    );

    writeFileSync(
      join(staging, "episode", "show-notes.json"),
      JSON.stringify(
        { guestVisible: showNotes.guestVisible, items: showNotes.items },
        null,
        2,
      ),
    );

    if (pollRow) {
      const poll = rowToDto(pollRow);
      writeFileSync(
        join(staging, "episode", "poll.json"),
        JSON.stringify(
          {
            enabled: poll.enabled,
            startAt: poll.startAt,
            endAt: poll.endAt,
            requireEmail: poll.requireEmail,
            publicResults: poll.publicResults,
            limitOneVotePerIp: poll.limitOneVotePerIp,
            questions: poll.questions,
          },
          null,
          2,
        ),
      );
    }

    if (episode.artworkPath) {
      const artAbs = resolveDataPath(episode.artworkPath);
      if (existsSync(artAbs)) {
        const ext = extname(artAbs) || ".jpg";
        copyFileSync(artAbs, join(staging, "episode", `artwork${ext}`));
      }
    }

    const finalDir = join(staging, "episode", "final");
    mkdirSync(finalDir, { recursive: true });
    if (episode.audioFinalPath) {
      const finalAbs = resolveDataPath(episode.audioFinalPath);
      if (existsSync(finalAbs)) {
        const ext = extname(finalAbs) || ".mp3";
        copyFileSync(finalAbs, join(finalDir, `final${ext}`));
        const wav = waveformPath(finalAbs);
        if (existsSync(wav)) {
          copyFileSync(wav, join(finalDir, `final${WAVEFORM_EXTENSION}`));
        }
      }
    }
    const srt = transcriptSrtPath(podcastId, episodeId);
    if (existsSync(srt)) copyFileSync(srt, join(finalDir, "transcript.srt"));
    const chapters = chaptersJsonPath(podcastId, episodeId);
    if (existsSync(chapters)) copyFileSync(chapters, join(finalDir, "chapters.json"));
    const video = episodeVideoPath(podcastId, episodeId);
    if (existsSync(video)) copyFileSync(video, join(finalDir, "video.mp4"));

    mkdirSync(join(staging, "segments"), { recursive: true });
    mkdirSync(join(staging, "library"), { recursive: true });
    const librarySeen = new Set<string>();

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const folder = safeSegmentFolderName(seg.name, i);
      const segDir = join(staging, "segments", folder);
      const includeLibrary =
        seg.reusableAssetId && !librarySeen.has(seg.reusableAssetId)
          ? join(staging, "library")
          : undefined;
      if (seg.reusableAssetId && includeLibrary) {
        librarySeen.add(seg.reusableAssetId);
      }
      await packSegmentIntoDir(segDir, podcastId, episodeId, seg, {
        includeLibraryDir: includeLibrary,
      });
    }

    ensureCacheDir();
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

/**
 * Return a cached or freshly built project zip path under /tmp.
 * Cache key is episodeId + content fingerprint. Older hashes for the same
 * episode are deleted. OS /tmp cleanup is relied on; no TTL daemon.
 */
export async function getOrBuildProjectZip(
  episodeId: string,
  podcastId: string,
): Promise<ProjectExportResult> {
  const episode = episodeRepo.getById(episodeId);
  if (!episode) throw new Error("Episode not found");
  const hash = fingerprintEpisode(episodeId, podcastId);
  ensureCacheDir();
  const zipPath = join(CACHE_DIR, `${episodeId}-${hash}.zip`);
  const podcastTitle =
    (getPodcastTitle(podcastId) ?? "Podcast").trim() || "Podcast";
  const filename = projectZipFilename(episode.title, podcastTitle);

  if (existsSync(zipPath)) {
    try {
      statSync(zipPath);
      return { zipPath, filename, fromCache: true };
    } catch {
      // rebuild
    }
  }

  await buildZipToPath(episodeId, podcastId, zipPath);
  deleteOlderCaches(episodeId, hash);
  return { zipPath, filename, fromCache: false };
}

export function streamProjectZip(zipPath: string) {
  return createReadStream(zipPath);
}

/** Exposed for tests / diagnostics. */
export function projectExportCacheDir(): string {
  return CACHE_DIR;
}
