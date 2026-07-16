import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { basename, extname, join } from "path";
import { tmpdir } from "os";
import { nanoid } from "nanoid";
import AdmZip from "adm-zip";
import { eq } from "drizzle-orm";
import type { EpisodePollPutBody } from "@harborfm/shared";
import { APP_NAME, AUDIOWAVEFORM_PATH, WAVEFORM_EXTENSION } from "../../config.js";
import { checkCommand } from "../../utils/commands.js";
import { drizzleDb } from "../../db/index.js";
import {
  episodeSegments,
  episodeShowNotesItems,
  podcastCast,
} from "../../db/schema.js";
import { sqlNow } from "../../db/utils.js";
import { getPodcastOwnerId } from "../../services/access.js";
import {
  artworkDir,
  assertResolvedPathUnder,
  chaptersJsonPath,
  episodeVideoPath,
  libraryAssetPath,
  multitrackRecordingsDir,
  pathRelativeToData,
  processedDir,
  segmentPath,
  transcriptSrtPath,
  uploadsDir,
} from "../../services/paths.js";
import * as audioService from "../../services/audio.js";
import {
  pruneMarkersForDuration,
  remakeMixFromMultitrackDir,
  type MultitrackManifest,
} from "../../services/multitrackRemake.js";
import { sha256FileSync } from "../../utils/hash.js";
import { waveformPath } from "../segments/utils.js";
import * as episodeRepo from "./repo.js";
import { slugify } from "./utils.js";
import { insertAsset } from "../library/repo.js";
import {
  addUserDiskBytes,
  updateSegmentAudio,
  updateSegmentMarkers,
} from "../segments/repo.js";
import { upsertPoll } from "../polls/repo.js";
import { PROJECT_FORMAT_VERSION } from "./projectExport.js";
import {
  findFirstFile,
  findSegmentAudioFile,
  nameFromSegmentFolder,
  readJsonFile,
  pruneMissingManifestTracks,
  recordingsTracksChanged,
  rewriteManifestPaths,
  stringifyJsonField,
  type SegmentProjectJson,
} from "./projectSegmentShared.js";

export type ProjectImportResult = {
  episodeId: string;
  slug: string;
};

type EpisodeProjectJson = {
  title?: string;
  description?: string;
  subtitle?: string | null;
  summary?: string | null;
  contentEncoded?: string | null;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  episodeType?: string | null;
  explicit?: boolean | null;
  episodeLink?: string | null;
  artworkUrl?: string | null;
  subscriberOnly?: boolean | null;
  showNotesGuestVisible?: boolean | null;
  finalMarkers?: unknown;
  finalSoundbites?: unknown;
  contentLinks?: unknown;
  podcastTxts?: unknown;
  socialInteracts?: unknown;
  locations?: unknown;
  license?: string | null;
  podcastImages?: unknown;
  fundingLinks?: unknown;
  chat?: unknown;
  valueBlocks?: unknown;
  audioMime?: string | null;
  audioBytes?: number | null;
  audioDurationSec?: number | null;
  castNames?: string[];
};

function isFinalAudioName(name: string): boolean {
  if (name.includes("waveform")) return false;
  return /^final\.(mp3|wav|m4a|ogg|webm)$/i.test(name);
}

/**
 * Import a HarborFM project zip into podcastId as a new draft episode.
 * Creates new UUIDs for episode and segments; embeds library assets for the importer.
 * Regenerates waveforms (and remakes the segment mix from multitrack) when audio hashes diverge.
 */
export async function importProjectZip(
  podcastId: string,
  zipPath: string,
  importerUserId: string,
): Promise<ProjectImportResult> {
  const extractRoot = join(
    tmpdir(),
    `harborfm-project-import-${nanoid()}`,
  );
  mkdirSync(extractRoot, { recursive: true });

  let bytesAdded = 0;
  try {
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(extractRoot, true);

    const rootManifestPath = join(extractRoot, "harborfm-project.json");
    if (!existsSync(rootManifestPath)) {
      throw new ImportValidationError("Missing harborfm-project.json");
    }
    const rootManifest = readJsonFile<{
      formatVersion?: number;
      kind?: string;
    }>(rootManifestPath);
    if (rootManifest.formatVersion !== PROJECT_FORMAT_VERSION) {
      throw new ImportValidationError(
        `Unsupported project formatVersion (expected ${PROJECT_FORMAT_VERSION})`,
      );
    }
    if (rootManifest.kind === "segment") {
      throw new ImportValidationError(
        "This zip is a segment project. Use Import Segment from Manage segment on the episode editor, not Import Project on the Episodes page.",
      );
    }

    const episodeJsonPath = join(extractRoot, "episode", "episode.json");
    if (!existsSync(episodeJsonPath)) {
      throw new ImportValidationError("Missing episode/episode.json");
    }
    const segmentsDir = join(extractRoot, "segments");
    if (!existsSync(segmentsDir) || !statSync(segmentsDir).isDirectory()) {
      throw new ImportValidationError("Missing segments/ directory");
    }

    const episodeData = readJsonFile<EpisodeProjectJson>(episodeJsonPath);
    const title = (episodeData.title || "Imported Episode").trim() || "Imported Episode";

    const id = nanoid();
    const urnNamespace = APP_NAME.toLowerCase().replace(/\s+/g, "-");
    const guid = `urn:${urnNamespace}:episode:${id}`;
    let finalSlug = slugify(title) || `episode-${id.slice(0, 8)}`;
    let counter = 1;
    while (episodeRepo.slugExists(podcastId, finalSlug)) {
      finalSlug = `${slugify(title) || "episode"}-${counter}`;
      counter++;
    }

    const insertRow: episodeRepo.EpisodeInsert = {
      id,
      podcastId,
      title,
      description: episodeData.description ?? "",
      guid,
      subtitle: episodeData.subtitle ?? null,
      summary: episodeData.summary ?? null,
      contentEncoded: episodeData.contentEncoded ?? null,
      slug: finalSlug,
      seasonNumber: episodeData.seasonNumber ?? null,
      episodeNumber: episodeData.episodeNumber ?? null,
      episodeType: episodeData.episodeType ?? null,
      explicit:
        episodeData.explicit == null ? null : Boolean(episodeData.explicit),
      publishAt: null,
      status: "draft",
      artworkUrl: episodeData.artworkUrl ?? null,
      episodeLink: episodeData.episodeLink ?? null,
      guidIsPermalink: false,
      subscriberOnly: Boolean(episodeData.subscriberOnly),
      showNotesGuestVisible: Boolean(episodeData.showNotesGuestVisible),
      finalMarkers: stringifyJsonField(episodeData.finalMarkers),
      finalSoundbites: stringifyJsonField(episodeData.finalSoundbites),
      contentLinks: stringifyJsonField(episodeData.contentLinks),
      podcastTxts: stringifyJsonField(episodeData.podcastTxts),
      socialInteracts: stringifyJsonField(episodeData.socialInteracts),
      locations: stringifyJsonField(episodeData.locations),
      license: episodeData.license ?? null,
      podcastImages: stringifyJsonField(episodeData.podcastImages),
      fundingLinks: stringifyJsonField(episodeData.fundingLinks),
      chat: stringifyJsonField(episodeData.chat),
      valueBlocks: stringifyJsonField(episodeData.valueBlocks),
    };
    episodeRepo.insertEpisode(insertRow);

    // Artwork
    const artworkSrc = findFirstFile(join(extractRoot, "episode"), "artwork.");
    if (artworkSrc) {
      const ext = extname(artworkSrc).replace(/^\./, "") || "jpg";
      const dest = join(artworkDir(podcastId), `${nanoid()}.${ext}`);
      copyFileSync(artworkSrc, dest);
      bytesAdded += statSync(dest).size;
      episodeRepo.updateEpisode(id, {
        artworkPath: pathRelativeToData(dest),
        artworkUrl: null,
        updatedAt: sqlNow(),
      });
    }

    // Finals
    const finalSrcDir = join(extractRoot, "episode", "final");
    processedDir(podcastId, id);
    let audioFinalPath: string | null = null;
    if (existsSync(finalSrcDir)) {
      const finalName = readdirSync(finalSrcDir).find(isFinalAudioName);
      if (finalName) {
        const finalAudio = join(finalSrcDir, finalName);
        const ext = extname(finalAudio).replace(/^\./, "") || "mp3";
        const dest = join(processedDir(podcastId, id), `final.${ext}`);
        copyFileSync(finalAudio, dest);
        bytesAdded += statSync(dest).size;
        audioFinalPath = pathRelativeToData(dest);
        const wavSrc = join(finalSrcDir, `final${WAVEFORM_EXTENSION}`);
        if (existsSync(wavSrc)) {
          copyFileSync(wavSrc, waveformPath(dest));
          bytesAdded += statSync(waveformPath(dest)).size;
        }
      }
    }

    const srtSrc = join(finalSrcDir, "transcript.srt");
    if (existsSync(srtSrc)) {
      const dest = transcriptSrtPath(podcastId, id);
      copyFileSync(srtSrc, dest);
      bytesAdded += statSync(dest).size;
    }
    const chaptersSrc = join(finalSrcDir, "chapters.json");
    if (existsSync(chaptersSrc)) {
      const dest = chaptersJsonPath(podcastId, id);
      copyFileSync(chaptersSrc, dest);
      bytesAdded += statSync(dest).size;
    }
    const videoSrc = join(finalSrcDir, "video.mp4");
    let videoFinalPath: string | null = null;
    if (existsSync(videoSrc)) {
      const dest = episodeVideoPath(podcastId, id);
      copyFileSync(videoSrc, dest);
      bytesAdded += statSync(dest).size;
      videoFinalPath = pathRelativeToData(dest);
    }

    if (audioFinalPath || videoFinalPath) {
      episodeRepo.updateEpisode(id, {
        ...(audioFinalPath
          ? {
              audioFinalPath,
              audioMime: episodeData.audioMime ?? "audio/mpeg",
              audioBytes: episodeData.audioBytes ?? null,
              audioDurationSec: episodeData.audioDurationSec ?? null,
            }
          : {}),
        ...(videoFinalPath ? { videoFinalPath } : {}),
        updatedAt: sqlNow(),
      });
    }

    // Show notes
    const showNotesPath = join(extractRoot, "episode", "show-notes.json");
    if (existsSync(showNotesPath)) {
      const sn = readJsonFile<{
        guestVisible?: boolean;
        items?: Array<{
          id?: string;
          text?: string;
          durationMin?: number | null;
          checked?: boolean;
          position?: number;
        }>;
      }>(showNotesPath);
      if (typeof sn.guestVisible === "boolean") {
        episodeRepo.updateEpisode(id, {
          showNotesGuestVisible: sn.guestVisible,
          updatedAt: sqlNow(),
        });
      }
      const items = Array.isArray(sn.items) ? sn.items : [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const itemId = nanoid();
        const now = sqlNow();
        drizzleDb
          .insert(episodeShowNotesItems)
          .values({
            id: itemId,
            episodeId: id,
            position: item.position ?? i,
            text: item.text ?? "",
            durationMin: item.durationMin ?? null,
            checked: Boolean(item.checked),
            createdAt: now,
            updatedAt: now,
          })
          .run();
      }
    }

    // Poll (definition only)
    const pollPath = join(extractRoot, "episode", "poll.json");
    if (existsSync(pollPath)) {
      const poll = readJsonFile<{
        enabled?: boolean;
        startAt?: string | null;
        endAt?: string | null;
        requireEmail?: boolean;
        publicResults?: boolean;
        limitOneVotePerIp?: boolean;
        questions?: unknown;
      }>(pollPath);
      if (Array.isArray(poll.questions)) {
        const body: EpisodePollPutBody = {
          enabled: Boolean(poll.enabled),
          startAt: poll.startAt ?? null,
          endAt: poll.endAt ?? null,
          requireEmail: Boolean(poll.requireEmail),
          publicResults: Boolean(poll.publicResults),
          limitOneVotePerIp: Boolean(poll.limitOneVotePerIp),
          questions: poll.questions as EpisodePollPutBody["questions"],
        };
        upsertPoll(id, body);
      }
    }

    // Cast by name match on destination show
    const castNames = Array.isArray(episodeData.castNames)
      ? episodeData.castNames
      : [];
    if (castNames.length > 0) {
      const showCast = drizzleDb
        .select({ id: podcastCast.id, name: podcastCast.name })
        .from(podcastCast)
        .where(eq(podcastCast.podcastId, podcastId))
        .all();
      const byName = new Map(
        showCast.map((c) => [c.name.trim().toLowerCase(), c.id]),
      );
      const matched: string[] = [];
      for (const name of castNames) {
        const key = String(name).trim().toLowerCase();
        const castId = byName.get(key);
        if (castId) matched.push(castId);
      }
      if (matched.length) episodeRepo.replaceEpisodeCast(id, matched);
    }

    // Library assets map: originalId -> newId
    const libraryMap = new Map<string, string>();
    const libraryRoot = join(extractRoot, "library");
    if (existsSync(libraryRoot)) {
      for (const assetFolder of readdirSync(libraryRoot)) {
        const libDir = join(libraryRoot, assetFolder);
        if (!statSync(libDir).isDirectory()) continue;
        const assetJsonPath = join(libDir, "asset.json");
        if (!existsSync(assetJsonPath)) continue;
        const assetMeta = readJsonFile<{
          originalId?: string;
          name?: string;
          durationSec?: number;
          tag?: string | null;
          copyright?: string | null;
          license?: string | null;
          sourceUrl?: string | null;
        }>(assetJsonPath);
        const audioSrc = findFirstFile(libDir, "audio.");
        if (!audioSrc) continue;
        const newAssetId = nanoid();
        const ext = extname(audioSrc).replace(/^\./, "") || "mp3";
        const dest = libraryAssetPath(importerUserId, newAssetId, ext);
        copyFileSync(audioSrc, dest);
        bytesAdded += statSync(dest).size;
        insertAsset({
          id: newAssetId,
          ownerUserId: importerUserId,
          name: assetMeta.name || "Imported asset",
          audioPath: pathRelativeToData(dest),
          durationSec: assetMeta.durationSec ?? 0,
          tag: assetMeta.tag ?? null,
          globalAsset: false,
          copyright: assetMeta.copyright ?? null,
          license: assetMeta.license ?? null,
          sourceUrl: assetMeta.sourceUrl ?? null,
        });
        const originalId = assetMeta.originalId || assetFolder;
        libraryMap.set(originalId, newAssetId);
      }
    }

    // Segments in folder order (hand-added folders without segment.json are allowed)
    const segFolders = readdirSync(segmentsDir)
      .filter((n) => statSync(join(segmentsDir, n)).isDirectory())
      .sort();
    const episodeUploads = uploadsDir(podcastId, id);
    const waveformsAvailable = await checkCommand(AUDIOWAVEFORM_PATH, [
      "--version",
    ]);

    for (let i = 0; i < segFolders.length; i++) {
      const folder = segFolders[i];
      const segDir = join(segmentsDir, folder);
      const segJsonPath = join(segDir, "segment.json");
      const missingSegmentJson = !existsSync(segJsonPath);
      const segMeta: SegmentProjectJson = missingSegmentJson
        ? {
            type: "recorded",
            position: i,
            name: nameFromSegmentFolder(folder),
            durationSec: 0,
            audioFile: null,
          }
        : readJsonFile<SegmentProjectJson>(segJsonPath);

      const audioSrc = findSegmentAudioFile(segDir, segMeta.audioFile);
      // Skip empty placeholder folders (no audio and not a reusable with library id)
      if (
        !audioSrc &&
        !(segMeta.type === "reusable" && segMeta.reusableAssetId)
      ) {
        continue;
      }

      const newSegId = nanoid();
      const position = typeof segMeta.position === "number" ? segMeta.position : i;
      const name = segMeta.name ?? nameFromSegmentFolder(folder);
      let durationSec = segMeta.durationSec ?? 0;
      let markers: unknown = segMeta.markers;
      const type = segMeta.type === "reusable" ? "reusable" : "recorded";

      let audioPathRel: string | null = null;
      let audioAbsDest: string | null = null;
      let audioChanged = missingSegmentJson;
      let needSegmentWaveformRegen = missingSegmentJson;
      const missingWaveformInZip = !existsSync(join(segDir, "waveform.json"));

      if (audioSrc && type === "recorded") {
        const srcExt = extname(audioSrc).toLowerCase().replace(/^\./, "") || "mp3";
        if (srcExt === "wav") {
          // Hand-edited / hand-added WAVs are stored as MP3.
          const dest = segmentPath(podcastId, id, newSegId, "mp3");
          assertResolvedPathUnder(dest, episodeUploads);
          // Stage under episode uploads so path checks pass (zip extract is outside DATA_DIR).
          const stagedWav = join(episodeUploads, `_import_${newSegId}.wav`);
          copyFileSync(audioSrc, stagedWav);
          try {
            await audioService.transcodeToMp3(stagedWav, dest, episodeUploads);
          } finally {
            try {
              rmSync(stagedWav, { force: true });
            } catch {
              // ignore
            }
          }
          bytesAdded += statSync(dest).size;
          audioPathRel = pathRelativeToData(dest);
          audioAbsDest = dest;
          audioChanged = true;
          needSegmentWaveformRegen = true;
        } else {
          const dest = segmentPath(podcastId, id, newSegId, srcExt || "mp3");
          copyFileSync(audioSrc, dest);
          bytesAdded += statSync(dest).size;
          audioPathRel = pathRelativeToData(dest);
          audioAbsDest = dest;
          const currentAudioHash = sha256FileSync(dest);
          if (
            missingSegmentJson ||
            (typeof segMeta.audioSha256 === "string" &&
              segMeta.audioSha256 &&
              currentAudioHash &&
              currentAudioHash !== segMeta.audioSha256)
          ) {
            audioChanged = true;
            needSegmentWaveformRegen = true;
          } else if (!missingWaveformInZip) {
            const wavSrc = join(segDir, "waveform.json");
            const zipWavHash = sha256FileSync(wavSrc);
            if (
              typeof segMeta.waveformSha256 === "string" &&
              segMeta.waveformSha256 &&
              zipWavHash &&
              zipWavHash !== segMeta.waveformSha256
            ) {
              needSegmentWaveformRegen = true;
            } else {
              copyFileSync(wavSrc, waveformPath(dest));
              bytesAdded += statSync(waveformPath(dest)).size;
            }
          } else {
            needSegmentWaveformRegen = true;
          }
        }
      }

      let reusableAssetId: string | null = null;
      if (type === "reusable" && segMeta.reusableAssetId) {
        reusableAssetId = libraryMap.get(segMeta.reusableAssetId) ?? null;
        if (!reusableAssetId && audioSrc) {
          const newAssetId = nanoid();
          const ext = extname(audioSrc).replace(/^\./, "") || "mp3";
          const dest = libraryAssetPath(importerUserId, newAssetId, ext);
          copyFileSync(audioSrc, dest);
          bytesAdded += statSync(dest).size;
          insertAsset({
            id: newAssetId,
            ownerUserId: importerUserId,
            name: String(name || "Imported asset"),
            audioPath: pathRelativeToData(dest),
            durationSec,
            tag: null,
            globalAsset: false,
            copyright: null,
            license: null,
            sourceUrl: null,
          });
          reusableAssetId = newAssetId;
        }
      }

      let insertType: "recorded" | "reusable" = type;
      if (type === "reusable" && !reusableAssetId) {
        insertType = "recorded";
        if (!audioPathRel && audioSrc) {
          const ext = extname(audioSrc).replace(/^\./, "") || "mp3";
          if (ext === "wav") {
            const dest = segmentPath(podcastId, id, newSegId, "mp3");
            assertResolvedPathUnder(dest, episodeUploads);
            const stagedWav = join(episodeUploads, `_import_${newSegId}.wav`);
            copyFileSync(audioSrc, stagedWav);
            try {
              await audioService.transcodeToMp3(stagedWav, dest, episodeUploads);
            } finally {
              try {
                rmSync(stagedWav, { force: true });
              } catch {
                // ignore
              }
            }
            audioPathRel = pathRelativeToData(dest);
            audioAbsDest = dest;
          } else {
            const dest = segmentPath(podcastId, id, newSegId, ext);
            copyFileSync(audioSrc, dest);
            audioPathRel = pathRelativeToData(dest);
            audioAbsDest = dest;
          }
          bytesAdded += statSync(audioAbsDest!).size;
          needSegmentWaveformRegen = true;
          audioChanged = true;
        }
      }

      drizzleDb
        .insert(episodeSegments)
        .values({
          id: newSegId,
          episodeId: id,
          position,
          type: insertType,
          name: String(name),
          reusableAssetId: insertType === "reusable" ? reusableAssetId : null,
          audioPath: insertType === "recorded" ? audioPathRel : null,
          durationSec,
          trimRanges: stringifyJsonField(segMeta.trimRanges),
          markers: stringifyJsonField(markers),
          audioEq: stringifyJsonField(segMeta.audioEq),
          disabled: Boolean(segMeta.disabled),
          inProgress: false,
          recordFailed: false,
        })
        .run();

      // Multitrack recordings
      const recSrc = join(segDir, "recordings");
      let mtDest: string | null = null;
      let manifest: MultitrackManifest | null = null;
      let tracksChanged = false;
      if (existsSync(recSrc) && statSync(recSrc).isDirectory()) {
        let epochMs: number | undefined;
        const manifestSrc = join(recSrc, "tracks_manifest.json");
        if (existsSync(manifestSrc)) {
          try {
            manifest = rewriteManifestPaths(
              JSON.parse(readFileSync(manifestSrc, "utf8")),
            ) as MultitrackManifest;
            if (typeof manifest.recordingEpochMs === "number") {
              epochMs = manifest.recordingEpochMs;
            }
          } catch {
            manifest = null;
          }
        }
        mtDest = multitrackRecordingsDir(podcastId, id, newSegId, epochMs);
        for (const fname of readdirSync(recSrc)) {
          const src = join(recSrc, fname);
          if (!statSync(src).isFile()) continue;
          if (fname === "tracks_manifest.json") continue;
          copyFileSync(src, join(mtDest, basename(fname)));
          bytesAdded += statSync(join(mtDest, basename(fname))).size;
        }
        if (manifest) {
          tracksChanged = recordingsTracksChanged(mtDest, manifest);
          // Missing audio files = deleted tracks; drop them from the persisted manifest.
          manifest = pruneMissingManifestTracks(mtDest, manifest);
          writeFileSync(
            join(mtDest, "tracks_manifest.json"),
            JSON.stringify(manifest, null, 2),
          );
        }
      }

      if (tracksChanged && mtDest && manifest && insertType === "recorded") {
        // Regen per-track waveforms, remake segment mix, keep/prune markers.
        for (const entry of manifest.segments ?? []) {
          const rel = typeof entry.filePath === "string" ? entry.filePath : null;
          if (!rel) continue;
          const trackAbs = join(mtDest, basename(rel.replace(/\\/g, "/")));
          if (!existsSync(trackAbs)) continue;
          try {
            if (waveformsAvailable) {
              await audioService.generateWaveformFile(trackAbs, mtDest);
            }
            entry.fileSha256 = sha256FileSync(trackAbs) ?? entry.fileSha256;
            entry.waveformSha256 =
              sha256FileSync(waveformPath(trackAbs)) ?? undefined;
          } catch {
            // non-fatal per track
          }
        }
        writeFileSync(
          join(mtDest, "tracks_manifest.json"),
          JSON.stringify(manifest, null, 2),
        );

        const mixDest = segmentPath(podcastId, id, newSegId, "wav");
        try {
          const remade = await remakeMixFromMultitrackDir(
            mtDest,
            manifest,
            mixDest,
            episodeUploads,
          );
          audioAbsDest = mixDest;
          audioPathRel = pathRelativeToData(mixDest);
          durationSec = remade.durationSec;
          markers = pruneMarkersForDuration(markers, durationSec);
          await audioService.generateWaveformFile(mixDest, episodeUploads);
          updateSegmentAudio(newSegId, id, mixDest, durationSec, {
            markers: stringifyJsonField(markers) ?? "[]",
          });
          bytesAdded += statSync(mixDest).size;
          needSegmentWaveformRegen = false;
          audioChanged = false;
        } catch {
          // Fall back to imported audio; still try waveform regen below.
          needSegmentWaveformRegen = true;
        }
      }

      if (
        insertType === "recorded" &&
        audioAbsDest &&
        existsSync(audioAbsDest) &&
        (needSegmentWaveformRegen || audioChanged || durationSec <= 0)
      ) {
        if (waveformsAvailable && (needSegmentWaveformRegen || audioChanged)) {
          try {
            await audioService.generateWaveformFile(
              audioAbsDest,
              episodeUploads,
            );
          } catch {
            // non-fatal when audiowaveform fails
          }
        }
        if (audioChanged || durationSec <= 0) {
          try {
            const probe = await audioService.probeAudio(
              audioAbsDest,
              episodeUploads,
            );
            durationSec = probe.durationSec;
            markers = pruneMarkersForDuration(markers, durationSec);
            updateSegmentAudio(newSegId, id, audioAbsDest, durationSec, {
              markers: stringifyJsonField(markers) ?? "[]",
            });
          } catch {
            updateSegmentMarkers(
              newSegId,
              id,
              stringifyJsonField(pruneMarkersForDuration(markers, durationSec)) ??
                "[]",
            );
          }
        }
      }
    }

    const ownerId = getPodcastOwnerId(podcastId) ?? importerUserId;
    if (bytesAdded > 0) {
      addUserDiskBytes(ownerId, bytesAdded);
    }

    return { episodeId: id, slug: finalSlug };
  } finally {
    try {
      rmSync(extractRoot, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
}

export class ImportValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportValidationError";
  }
}

/** Write uploaded buffer/stream path helper for routes. */
export function writeTempZip(buffer: Buffer): string {
  const path = join(tmpdir(), `harborfm-import-upload-${nanoid()}.zip`);
  writeFileSync(path, buffer);
  return path;
}

export function removeTempPath(path: string): void {
  try {
    if (existsSync(path)) rmSync(path, { recursive: true, force: true });
  } catch {
    // ignore
  }
}
