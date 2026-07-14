import type { FastifyInstance } from "fastify";
import {
  existsSync,
  unlinkSync,
  writeFileSync,
  statSync,
  copyFileSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { nanoid } from "nanoid";
import { randomUUID } from "crypto";
import { drizzleDb } from "../../db/index.js";
import { sqlNow } from "../../db/utils.js";
import { podcastImportBodySchema } from "@harborfm/shared";
import { requireAuth, requireNotReadOnly } from "../../plugins/auth.js";
import { getPodcastOwnerId } from "../../services/access.js";
import {
  fetchAndParseFeed,
  fetchImportTextUrl,
  parsePodcastChaptersJson,
  type ImportChannelMeta,
  type ImportEpisodeItem,
} from "../../services/importFeed.js";
import { writeEpisodeChaptersJson } from "../../services/episodeChapters.js";
import { deleteTokenFeedTemplateFile, writeRssFile } from "../../services/rss.js";
import { notifyWebSubHub } from "../../services/websub.js";
import {
  uploadsDir,
  segmentPath,
  processedDir,
  artworkDir,
  pathRelativeToData,
} from "../../services/paths.js";
import { wouldExceedStorageLimit } from "../../services/storageLimit.js";
import { readSettings, isTranscriptionProviderConfigured } from "../settings/index.js";
import * as audioService from "../../services/audio.js";
import { extensionFromAudioMimetype } from "../../services/uploads.js";
import {
  APP_NAME,
  SEGMENT_UPLOAD_MAX_BYTES,
  OPENAI_TRANSCRIPTION_DEFAULT_URL,
} from "../../config.js";
import { generateSrtFromWhisper, generateSrtFromOpenAI } from "../segments/index.js";
import {
  slugify,
  downloadToFile,
  downloadArtworkToPath,
  extFromUrl,
  importStatusByPodcastId,
  activeImportByUserId,
} from "./utils.js";
import * as repo from "./repo.js";
import * as episodesRepo from "../episodes/repo.js";
import { sendNewShowCongratulationsEmail } from "../podcasts/service.js";

export async function registerImportRoutes(app: FastifyInstance) {
  app.post(
    "/podcasts/import",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Podcasts"],
        summary: "Import podcast from RSS/Atom feed URL",
        description:
          "Starts a background import. Returns 202 with podcastId. Poll GET /podcasts/:id/import-status for progress.",
        body: {
          type: "object",
          properties: { feedUrl: { type: "string", format: "uri" } },
          required: ["feedUrl"],
        },
        response: {
          202: {
            description: "Import started",
            type: "object",
            properties: { podcastId: { type: "string" } },
            required: ["podcastId"],
          },
          400: { description: "Invalid URL or feed" },
          403: { description: "At podcast limit or read-only" },
          409: { description: "Already have an import in progress" },
        },
      },
    },
    async (request, reply) => {
      const parsed = podcastImportBodySchema.safeParse(request.body);
      if (!parsed.success) {
        const first =
          parsed.error.flatten().fieldErrors.feedUrl?.[0] ??
          parsed.error.message;
        return reply.status(400).send({ error: first });
      }
      const feedUrl = parsed.data.feedUrl;

      const userId = request.userId as string;
      if (activeImportByUserId.has(userId)) {
        return reply.status(409).send({
          error:
            "You already have an import in progress. Wait for it to finish or refresh the page to see its status.",
        });
      }
      const maxPodcasts = repo.getUserMaxPodcasts(userId);
      if (maxPodcasts != null && maxPodcasts > 0) {
        const count = repo.countUserPodcasts(userId);
        if (count >= maxPodcasts) {
          return reply.status(403).send({
            error: `You have reached your limit of ${maxPodcasts} show${maxPodcasts === 1 ? "" : "s"}. You cannot create more.`,
          });
        }
      }

      let result: { channel: ImportChannelMeta; episodes: ImportEpisodeItem[] };
      try {
        result = await fetchAndParseFeed(feedUrl);
      } catch (err) {
        request.log.warn({ err, feedUrl }, "Feed fetch/parse failed");
        return reply.status(400).send({
          error:
            err instanceof Error
              ? err.message
              : "Failed to fetch or parse feed",
        });
      }

      const { channel, episodes } = result;
      request.log.info(
        {
          title: channel.title,
          categories: {
            primary: channel.category_primary || null,
            secondary: channel.category_secondary ?? null,
            primary_two: channel.category_primary_two ?? null,
            secondary_two: channel.category_secondary_two ?? null,
            primary_three: channel.category_primary_three ?? null,
            secondary_three: channel.category_secondary_three ?? null,
          },
          podcast_guid: channel.podcast_guid ?? null,
          locked: channel.locked,
        },
        "Import: parsed channel meta",
      );
      const baseSlug = slugify(channel.title) || "imported-podcast";
      let slug = baseSlug;
      let counter = 1;
      while (repo.podcastSlugExists(slug)) {
        slug = `${baseSlug}-${counter}`;
        counter++;
      }

      const podcastId = nanoid();
      const podcastGuid = channel.podcast_guid ?? randomUUID();

      repo.insertPodcast({
        id: podcastId,
        ownerUserId: userId,
        title: channel.title,
        slug,
        description: channel.description ?? "",
        subtitle: channel.subtitle ?? null,
        summary: channel.summary ?? null,
        language: channel.language ?? "en",
        authorName: channel.author_name ?? "",
        ownerName: channel.owner_name ?? "",
        email: channel.email ?? "",
        categoryPrimary: channel.category_primary ?? "",
        categorySecondary: channel.category_secondary ?? null,
        categoryPrimaryTwo: channel.category_primary_two ?? null,
        categorySecondaryTwo: channel.category_secondary_two ?? null,
        categoryPrimaryThree: channel.category_primary_three ?? null,
        categorySecondaryThree: channel.category_secondary_three ?? null,
        explicit: Boolean(channel.explicit ?? 0),
        siteUrl: channel.site_url ?? null,
        artworkUrl: channel.artwork_url ?? null,
        copyright: channel.copyright ?? null,
        podcastGuid,
        locked: Boolean(channel.locked ?? 0),
        license: channel.license ?? null,
        itunesType: channel.itunes_type ?? "episodic",
        medium: channel.medium ?? "podcast",
        fundingLinks: channel.funding_links ?? null,
        persons: channel.persons ?? null,
        updateFrequency: channel.update_frequency ?? null,
        podcastTxts: channel.podcast_txts ?? null,
        socialInteracts: channel.social_interacts ?? null,
        locations: channel.locations ?? null,
        chat: channel.chat ?? null,
        valueBlocks: channel.value_blocks ?? null,
        blocks: channel.blocks ?? null,
        publisher: channel.publisher ?? null,
        podroll: channel.podroll ?? null,
        spotifyRecentCount: channel.spotify_recent_count ?? null,
        spotifyCountryOfOrigin: channel.spotify_country_of_origin ?? null,
        applePodcastsVerify: channel.apple_podcasts_verify ?? null,
        maxEpisodes: null,
      });

      for (const person of channel.person_records ?? []) {
        const name = person.name?.trim();
        if (!name) continue;
        const roleRaw = (person.role ?? "host").toLowerCase();
        const role: "host" | "guest" = roleRaw === "guest" ? "guest" : "host";
        try {
          repo.insertCastMember({
            id: nanoid(),
            podcastId,
            name: name.slice(0, 128),
            role,
            photoUrl: person.img?.trim() || null,
            socialLinkText: person.href?.trim() || null,
            isPublic: true,
          });
        } catch (err) {
          request.log.warn({ err, podcastId, name }, "Import cast member failed");
        }
      }

      if (channel.artwork_url) {
        try {
          const ext = extFromUrl(channel.artwork_url);
          const dir = artworkDir(podcastId);
          const artworkPath = join(dir, `${nanoid()}.${ext}`);
          await downloadArtworkToPath(channel.artwork_url, artworkPath);
          repo.updatePodcastArtwork(podcastId, pathRelativeToData(artworkPath));
        } catch (err) {
          request.log.warn(
            { err, podcastId },
            "Podcast artwork download failed",
          );
        }
      }

      importStatusByPodcastId.set(podcastId, {
        status: "pending",
        total: episodes.length,
        current: 0,
        message: episodes.length === 0 ? "No episodes to import" : undefined,
      });
      activeImportByUserId.set(userId, podcastId);

      const log = request.log;
      setImmediate(() => {
        (async () => {
          const state = importStatusByPodcastId.get(podcastId);
          if (!state || state.status !== "pending") return;

          const ownerId = getPodcastOwnerId(podcastId) ?? userId;
          const settings = readSettings();

          for (let i = 0; i < episodes.length; i++) {
            const ep = episodes[i];
            importStatusByPodcastId.set(podcastId, {
              status: "importing",
              current: i,
              total: episodes.length,
              message: `Importing episode ${i + 1} of ${episodes.length}`,
            });

            const { maxEpisodes } = episodesRepo.getCreateLimit(podcastId);
            if (maxEpisodes != null && maxEpisodes > 0) {
              const epCount = episodesRepo.countByPodcastId(podcastId);
              if (epCount >= maxEpisodes) {
                importStatusByPodcastId.set(podcastId, {
                  status: "done",
                  current: i,
                  total: episodes.length,
                  message: `Stopped at episode limit. Imported ${i} of ${episodes.length} episodes.`,
                });
                try {
                  writeRssFile(podcastId, null);
                  deleteTokenFeedTemplateFile(podcastId);
                  notifyWebSubHub(podcastId, null);
                } catch (_) {
                  /* ignore */
                }
                sendNewShowCongratulationsEmail(
                  podcastId,
                  { title: channel.title, slug },
                  ownerId,
                  log,
                );
                return;
              }
            }

            let tempPath: string | null = null;
            const urnNamespace = APP_NAME.toLowerCase().replace(/\s+/g, "-");

            try {
              tempPath = join(tmpdir(), `${urnNamespace}-import-${nanoid()}`);
              await downloadToFile(
                ep.enclosureUrl,
                tempPath,
                SEGMENT_UPLOAD_MAX_BYTES,
              );
              const bytesWritten = statSync(tempPath).size;

              if (wouldExceedStorageLimit(drizzleDb, ownerId, bytesWritten)) {
                importStatusByPodcastId.set(podcastId, {
                  status: "done",
                  current: i,
                  total: episodes.length,
                  message: `Stopped: storage limit reached. Imported ${i} of ${episodes.length} episodes.`,
                });
                try {
                  writeRssFile(podcastId, null);
                  deleteTokenFeedTemplateFile(podcastId);
                  notifyWebSubHub(podcastId, null);
                } catch (_) {
                  /* ignore */
                }
                sendNewShowCongratulationsEmail(
                  podcastId,
                  { title: channel.title, slug },
                  ownerId,
                  log,
                );
                return;
              }

              const episodeId = nanoid();
              const guid =
                ep.guid && ep.guid.trim()
                  ? ep.guid.trim()
                  : `urn:${urnNamespace}:episode:${episodeId}`;
              const episodeSlugBase = slugify(ep.title) || `episode-${i + 1}`;
              let episodeSlug = episodeSlugBase;
              let slugCounter = 1;
              while (episodesRepo.slugExists(podcastId, episodeSlug)) {
                episodeSlug = `${episodeSlugBase}-${slugCounter}`;
                slugCounter++;
              }

              const pubDateParsed = ep.pubDate ? new Date(ep.pubDate) : null;
              const publishAt =
                pubDateParsed && Number.isFinite(pubDateParsed.getTime())
                  ? pubDateParsed.toISOString()
                  : null;
              episodesRepo.insertEpisode({
                id: episodeId,
                podcastId,
                title: ep.title,
                description: ep.description ?? "",
                subtitle: ep.subtitle ?? null,
                summary: ep.summary ?? null,
                contentEncoded: ep.content_encoded ?? null,
                slug: episodeSlug,
                guid,
                seasonNumber: ep.season_number ?? null,
                episodeNumber: ep.episode_number ?? null,
                episodeType: ep.episode_type ?? null,
                explicit:
                  ep.explicit != null ? Boolean(ep.explicit) : null,
                publishAt,
                status: "published",
                artworkUrl: ep.artwork_url ?? null,
                episodeLink: ep.episode_link ?? null,
                guidIsPermalink: Boolean(ep.guidIsPermalink ?? 0),
                contentLinks: ep.content_links ?? null,
                podcastTxts: ep.podcast_txts ?? null,
                socialInteracts: ep.social_interacts ?? null,
                locations: ep.locations ?? null,
                license: ep.license ?? null,
                podcastImages: ep.podcast_images ?? null,
                fundingLinks: ep.funding_links ?? null,
                chat: ep.chat ?? null,
                valueBlocks: ep.value_blocks ?? null,
                finalSoundbites: ep.final_soundbites ?? null,
              });

              if (ep.artwork_url) {
                try {
                  const ext = extFromUrl(ep.artwork_url);
                  const dir = artworkDir(podcastId);
                  const episodeArtworkPath = join(dir, `${nanoid()}.${ext}`);
                  await downloadArtworkToPath(
                    ep.artwork_url,
                    episodeArtworkPath,
                  );
                  episodesRepo.updateEpisode(episodeId, {
                    artworkPath: pathRelativeToData(episodeArtworkPath),
                    artworkUrl: null,
                  });
                } catch (err) {
                  log.warn(
                    { err, episodeId },
                    "Episode artwork download failed",
                  );
                }
              }

              const segmentBase = uploadsDir(podcastId, episodeId);
              const ext = extensionFromAudioMimetype(ep.enclosureType);
              const segmentId = nanoid();
              const destPath = segmentPath(
                podcastId,
                episodeId,
                segmentId,
                ext,
              );
              copyFileSync(tempPath, destPath);
              unlinkSync(tempPath);
              tempPath = null;

              let finalPath = destPath;
              try {
                const normalized = await audioService.normalizeUploadToMp3OrWav(
                  destPath,
                  ext,
                  segmentBase,
                );
                finalPath = normalized.path;
              } catch (err) {
                log.warn({ err, episodeId }, "Normalize audio failed");
              }
              const bytesFinal = statSync(finalPath).size;

              if (wouldExceedStorageLimit(drizzleDb, ownerId, bytesFinal)) {
                episodesRepo.deleteEpisode(episodeId);
                importStatusByPodcastId.set(podcastId, {
                  status: "done",
                  current: i + 1,
                  total: episodes.length,
                  message: `Stopped: storage limit reached. Imported ${i} of ${episodes.length} episodes.`,
                });
                try {
                  writeRssFile(podcastId, null);
                  deleteTokenFeedTemplateFile(podcastId);
                  notifyWebSubHub(podcastId, null);
                } catch (_) {
                  /* ignore */
                }
                sendNewShowCongratulationsEmail(
                  podcastId,
                  { title: channel.title, slug },
                  ownerId,
                  log,
                );
                return;
              }

              try {
                await audioService.generateWaveformFile(finalPath, segmentBase);
              } catch (err) {
                log.warn({ err, episodeId }, "Segment waveform failed");
              }

              let durationSec = 0;
              try {
                const probe = await audioService.probeAudio(
                  finalPath,
                  segmentBase,
                );
                durationSec = Math.max(0, probe.durationSec);
              } catch (_) {
                /* ignore */
              }

              const nextPos = repo.getNextSegmentPosition(episodeId);
              repo.insertSegment({
                id: segmentId,
                episodeId,
                position: nextPos,
                type: "recorded",
                name: ep.title || "Episode",
                audioPath: pathRelativeToData(finalPath),
                durationSec,
              });

              repo.addUserDiskBytes(ownerId, bytesFinal);

              const outPath = audioService.getFinalOutputPath(
                podcastId,
                episodeId,
                settings.final_format,
              );
              await audioService.concatToFinal([finalPath], outPath, {
                format: settings.final_format,
                bitrateKbps: settings.final_bitrate_kbps,
                channels: settings.final_channels,
                loudnessTargetLufs: settings.loudness_target_lufs,
              });
              const meta = await audioService.getAudioMetaAfterProcess(
                podcastId,
                episodeId,
                settings.final_format,
              );
              episodesRepo.updateEpisode(episodeId, {
                audioFinalPath: pathRelativeToData(outPath),
                audioSourcePath: pathRelativeToData(outPath),
                audioMime: meta.mime,
                audioBytes: meta.sizeBytes,
                audioDurationSec: meta.durationSec,
                updatedAt: sqlNow(),
              });

              try {
                await audioService.generateWaveformFile(
                  outPath,
                  processedDir(podcastId, episodeId),
                );
              } catch (err) {
                log.warn({ err, episodeId }, "Final waveform failed");
              }

              const procDir = processedDir(podcastId, episodeId);

              // Restore chapters from feed <podcast:chapters url="…">
              if (ep.chapters_url) {
                try {
                  const chaptersBody = await fetchImportTextUrl(ep.chapters_url);
                  const markers = parsePodcastChaptersJson(chaptersBody);
                  if (markers && markers.length > 0) {
                    episodesRepo.updateEpisode(episodeId, {
                      finalMarkers: JSON.stringify(markers),
                      updatedAt: sqlNow(),
                    });
                    writeEpisodeChaptersJson(podcastId, episodeId, markers);
                  }
                } catch (err) {
                  log.warn(
                    { err, episodeId, url: ep.chapters_url },
                    "Import chapters fetch failed",
                  );
                }
              }

              // Restore transcript from feed <podcast:transcript url="…"> before ASR
              const transcriptPath = join(procDir, "transcript.srt");
              let importedTranscript = false;
              if (ep.transcript_url) {
                try {
                  const srtText = await fetchImportTextUrl(ep.transcript_url);
                  if (srtText.trim()) {
                    writeFileSync(transcriptPath, srtText, "utf-8");
                    importedTranscript = true;
                  }
                } catch (err) {
                  log.warn(
                    { err, episodeId, url: ep.transcript_url },
                    "Import transcript fetch failed",
                  );
                }
              }

              const ownerCanTranscribe = repo.getUserCanTranscribe(ownerId);
              if (
                !importedTranscript &&
                ownerCanTranscribe &&
                isTranscriptionProviderConfigured(settings)
              ) {
                try {
                  let srtText: string | null = null;
                  if (
                    settings.transcription_provider === "self_hosted" &&
                    settings.whisper_asr_url?.trim()
                  ) {
                    srtText = await generateSrtFromWhisper(
                      outPath,
                      procDir,
                      settings.whisper_asr_url,
                    );
                  } else if (
                    settings.transcription_provider === "openai" &&
                    settings.openai_transcription_api_key?.trim()
                  ) {
                    const url =
                      settings.openai_transcription_url?.trim() ??
                      OPENAI_TRANSCRIPTION_DEFAULT_URL;
                    const model =
                      settings.transcription_model?.trim() || "whisper-1";
                    srtText = await generateSrtFromOpenAI(outPath, procDir, {
                      url,
                      apiKey: settings.openai_transcription_api_key,
                      model,
                    });
                  }
                  if (srtText) {
                    writeFileSync(transcriptPath, srtText, "utf-8");
                  }
                } catch (err) {
                  log.warn({ err, episodeId }, "Transcription SRT failed");
                }
              }
            } catch (err) {
              if (tempPath && existsSync(tempPath)) {
                try {
                  unlinkSync(tempPath);
                } catch (_) {
                  /* ignore */
                }
              }
              log.error(
                { err, episodeIndex: i, podcastId },
                "Import episode failed",
              );
              importStatusByPodcastId.set(podcastId, {
                status: "failed",
                current: i,
                total: episodes.length,
                error: err instanceof Error ? err.message : "Import failed",
              });
              return;
            }
          }

          importStatusByPodcastId.set(podcastId, {
            status: "done",
            current: episodes.length,
            total: episodes.length,
            message: `Imported ${episodes.length} episode${episodes.length === 1 ? "" : "s"}.`,
          });
          try {
            writeRssFile(podcastId, null);
            deleteTokenFeedTemplateFile(podcastId);
            notifyWebSubHub(podcastId, null);
          } catch (_) {
            /* ignore */
          }
          sendNewShowCongratulationsEmail(
            podcastId,
            { title: channel.title, slug },
            ownerId,
            log,
          );
        })();
      });

      return reply.status(202).send({ podcastId });
    },
  );
}
