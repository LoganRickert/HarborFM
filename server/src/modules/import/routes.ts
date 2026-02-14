import type { FastifyInstance } from "fastify";
import {
  createWriteStream,
  existsSync,
  unlinkSync,
  writeFileSync,
  statSync,
} from "fs";
import { join } from "path";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import { Transform } from "stream";
import { tmpdir } from "os";
import { nanoid } from "nanoid";
import { randomUUID } from "crypto";
import { db } from "../../db/index.js";
import { podcastImportBodySchema } from "@harborfm/shared";
import { requireAuth, requireNotReadOnly } from "../../plugins/auth.js";
import { canAccessPodcast, getPodcastOwnerId } from "../../services/access.js";
import {
  fetchAndParseFeed,
  type ImportChannelMeta,
  type ImportEpisodeItem,
} from "../../services/importFeed.js";
import { deleteTokenFeedTemplateFile, writeRssFile } from "../../services/rss.js";
import { notifyWebSubHub } from "../../services/websub.js";
import { uploadsDir, segmentPath, processedDir, artworkDir } from "../../services/paths.js";
import { assertUrlNotPrivate } from "../../utils/ssrf.js";
import { wouldExceedStorageLimit } from "../../services/storageLimit.js";
import { readSettings, isTranscriptionProviderConfigured } from "../settings/index.js";
import * as audioService from "../../services/audio.js";
import { extensionFromAudioMimetype, FileTooLargeError } from "../../services/uploads.js";
import {
  APP_NAME,
  SEGMENT_UPLOAD_MAX_BYTES,
  IMPORT_USER_AGENT,
  IMPORT_FETCH_TIMEOUT_MS,
  ARTWORK_MAX_BYTES,
  OPENAI_TRANSCRIPTION_DEFAULT_URL,
} from "../../config.js";
import { generateSrtFromWhisper, generateSrtFromOpenAI } from "../segments/index.js";

export interface ImportStatusState {
  status: "pending" | "importing" | "done" | "failed";
  message?: string;
  error?: string;
  current?: number;
  total?: number;
}

const importStatusByPodcastId = new Map<string, ImportStatusState>();
/** userId -> podcastId: so we can block multiple imports and restore popup on refresh. */
const activeImportByUserId = new Map<string, string>();

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Download URL to file with size limit. Throws FileTooLargeError if exceeded.
 */
async function downloadToFile(
  url: string,
  destPath: string,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<number> {
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    IMPORT_FETCH_TIMEOUT_MS,
  );
  if (signal) {
    signal.addEventListener("abort", () => controller.abort());
  }
  try {
    await assertUrlNotPrivate(url);
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": IMPORT_USER_AGENT },
    });
    clearTimeout(timeoutId);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    const body = res.body;
    if (!body) throw new Error("No response body");

    const nodeStream = Readable.fromWeb(
      body as Parameters<typeof Readable.fromWeb>[0],
    );
    let bytes = 0;
    const limit = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        bytes += chunk.length;
        if (bytes > maxBytes) {
          cb(new FileTooLargeError());
          return;
        }
        cb(null, chunk);
      },
    });
    const out = createWriteStream(destPath, { flags: "w" });
    await pipeline(nodeStream, limit, out);
    return bytes;
  } finally {
    clearTimeout(timeoutId);
  }
}

function extFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const lower = pathname.toLowerCase();
    if (lower.endsWith(".png")) return "png";
    if (lower.endsWith(".webp")) return "webp";
    if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "jpg";
  } catch {
    // ignore
  }
  return "jpg";
}

/**
 * Download image from URL to destPath. Validates image type and size. Uses import User-Agent and timeout.
 */
async function downloadArtworkToPath(
  url: string,
  destPath: string,
  signal?: AbortSignal,
): Promise<void> {
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    IMPORT_FETCH_TIMEOUT_MS,
  );
  if (signal) {
    signal.addEventListener("abort", () => controller.abort());
  }
  try {
    await assertUrlNotPrivate(url);
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": IMPORT_USER_AGENT },
    });
    clearTimeout(timeoutId);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    const contentType = res.headers.get("Content-Type");
    const buf = await res.arrayBuffer();
    if (buf.byteLength > ARTWORK_MAX_BYTES)
      throw new Error(`Artwork too large (max ${ARTWORK_MAX_BYTES} bytes)`);
    const type = (contentType ?? "").toLowerCase();
    if (!type.startsWith("image/")) throw new Error("Not an image");
    writeFileSync(destPath, new Uint8Array(buf));
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function importRoutes(app: FastifyInstance) {
  app.post(
    "/podcasts/import",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Podcasts"],
        summary: "Import podcast from RSS/Atom feed URL",
        description:
          "Starts a background import. Returns 202 with podcast_id. Poll GET /podcasts/:id/import-status for progress.",
        body: {
          type: "object",
          properties: { feed_url: { type: "string", format: "uri" } },
          required: ["feed_url"],
        },
        response: {
          202: {
            description: "Import started",
            type: "object",
            properties: { podcast_id: { type: "string" } },
            required: ["podcast_id"],
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
          parsed.error.flatten().fieldErrors.feed_url?.[0] ??
          parsed.error.message;
        return reply.status(400).send({ error: first });
      }
      const feedUrl = parsed.data.feed_url;

      const userId = request.userId as string;
      if (activeImportByUserId.has(userId)) {
        return reply.status(409).send({
          error:
            "You already have an import in progress. Wait for it to finish or refresh the page to see its status.",
        });
      }
      const userRow = db
        .prepare("SELECT max_podcasts FROM users WHERE id = ?")
        .get(userId) as { max_podcasts: number | null } | undefined;
      const maxPodcasts = userRow?.max_podcasts ?? null;
      if (maxPodcasts != null && maxPodcasts > 0) {
        const count = db
          .prepare(
            "SELECT COUNT(*) as count FROM podcasts WHERE owner_user_id = ?",
          )
          .get(userId) as { count: number };
        if (count.count >= maxPodcasts) {
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
      while (db.prepare("SELECT id FROM podcasts WHERE slug = ?").get(slug)) {
        slug = `${baseSlug}-${counter}`;
        counter++;
      }

      const podcastId = nanoid();
      const podcastGuid = channel.podcast_guid ?? randomUUID();
      // Leave max_episodes NULL so the podcast uses the owner's current limit.

      db.prepare(
        `INSERT INTO podcasts (
          id, owner_user_id, title, slug, description, subtitle, summary, language, author_name, owner_name,
          email, category_primary, category_secondary, category_primary_two, category_secondary_two,
          category_primary_three, category_secondary_three, explicit, site_url, artwork_url,
          copyright, podcast_guid, locked, license, itunes_type, medium,
          funding_url, funding_label, persons, update_frequency_rrule, update_frequency_label,
          spotify_recent_count, spotify_country_of_origin, apple_podcasts_verify, max_episodes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        podcastId,
        userId,
        channel.title,
        slug,
        channel.description ?? "",
        channel.subtitle ?? null,
        channel.summary ?? null,
        channel.language ?? "en",
        channel.author_name ?? "",
        channel.owner_name ?? "",
        channel.email ?? "",
        channel.category_primary ?? "",
        channel.category_secondary ?? null,
        channel.category_primary_two ?? null,
        channel.category_secondary_two ?? null,
        channel.category_primary_three ?? null,
        channel.category_secondary_three ?? null,
        channel.explicit ?? 0,
        channel.site_url ?? null,
        channel.artwork_url ?? null,
        channel.copyright ?? null,
        podcastGuid,
        channel.locked ?? 0,
        channel.license ?? null,
        channel.itunes_type ?? "episodic",
        channel.medium ?? "podcast",
        channel.funding_url ?? null,
        channel.funding_label ?? null,
        channel.persons ?? null,
        channel.update_frequency_rrule ?? null,
        channel.update_frequency_label ?? null,
        channel.spotify_recent_count ?? null,
        channel.spotify_country_of_origin ?? null,
        channel.apple_podcasts_verify ?? null,
        null /* max_episodes: use owner's current limit */,
      );

      if (channel.artwork_url) {
        try {
          const ext = extFromUrl(channel.artwork_url);
          const dir = artworkDir(podcastId);
          const artworkPath = join(dir, `${nanoid()}.${ext}`);
          await downloadArtworkToPath(channel.artwork_url, artworkPath);
          db.prepare(
            "UPDATE podcasts SET artwork_path = ?, artwork_url = NULL WHERE id = ?",
          ).run(artworkPath, podcastId);
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

            const podcastRow = db
              .prepare("SELECT max_episodes FROM podcasts WHERE id = ?")
              .get(podcastId) as { max_episodes: number | null } | undefined;
            const ownerMax = db
              .prepare("SELECT max_episodes FROM users WHERE id = ?")
              .get(ownerId) as { max_episodes: number | null } | undefined;
            const maxEpisodes =
              podcastRow?.max_episodes ?? ownerMax?.max_episodes ?? null;
            if (maxEpisodes != null && maxEpisodes > 0) {
              const epCount = db
                .prepare(
                  "SELECT COUNT(*) as count FROM episodes WHERE podcast_id = ?",
                )
                .get(podcastId) as { count: number };
              if (epCount.count >= maxEpisodes) {
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

              if (wouldExceedStorageLimit(db, ownerId, bytesWritten)) {
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
              while (
                db
                  .prepare(
                    "SELECT id FROM episodes WHERE podcast_id = ? AND slug = ?",
                  )
                  .get(podcastId, episodeSlug)
              ) {
                episodeSlug = `${episodeSlugBase}-${slugCounter}`;
                slugCounter++;
              }

              const pubDateParsed = ep.pubDate ? new Date(ep.pubDate) : null;
              const publishAt =
                pubDateParsed && Number.isFinite(pubDateParsed.getTime())
                  ? pubDateParsed.toISOString()
                  : null;
              db.prepare(
                `INSERT INTO episodes (
                  id, podcast_id, title, description, subtitle, summary, content_encoded, slug, guid, season_number, episode_number,
                  episode_type, explicit, publish_at, status, artwork_url, episode_link, guid_is_permalink
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              ).run(
                episodeId,
                podcastId,
                ep.title,
                ep.description ?? "",
                ep.subtitle ?? null,
                ep.summary ?? null,
                ep.content_encoded ?? null,
                episodeSlug,
                guid,
                ep.season_number ?? null,
                ep.episode_number ?? null,
                ep.episode_type ?? null,
                ep.explicit ?? null,
                publishAt,
                "published",
                ep.artwork_url ?? null,
                null,
                ep.guidIsPermalink ?? 0,
              );

              if (ep.artwork_url) {
                try {
                  const ext = extFromUrl(ep.artwork_url);
                  const dir = artworkDir(podcastId);
                  const episodeArtworkPath = join(dir, `${nanoid()}.${ext}`);
                  await downloadArtworkToPath(
                    ep.artwork_url,
                    episodeArtworkPath,
                  );
                  db.prepare(
                    "UPDATE episodes SET artwork_path = ?, artwork_url = NULL WHERE id = ?",
                  ).run(episodeArtworkPath, episodeId);
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
              const { copyFileSync } = await import("fs");
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

              if (wouldExceedStorageLimit(db, ownerId, bytesFinal)) {
                db.prepare("DELETE FROM episodes WHERE id = ?").run(episodeId);
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

              const maxPos = db
                .prepare(
                  "SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM episode_segments WHERE episode_id = ?",
                )
                .get(episodeId) as { pos: number };
              db.prepare(
                `INSERT INTO episode_segments (id, episode_id, position, type, name, audio_path, duration_sec)
                 VALUES (?, ?, ?, 'recorded', ?, ?, ?)`,
              ).run(
                segmentId,
                episodeId,
                maxPos.pos,
                ep.title || "Episode",
                finalPath,
                durationSec,
              );

              db.prepare(
                `UPDATE users SET disk_bytes_used = COALESCE(disk_bytes_used, 0) + ? WHERE id = ?`,
              ).run(bytesFinal, ownerId);

              const outPath = audioService.getFinalOutputPath(
                podcastId,
                episodeId,
                settings.final_format,
              );
              await audioService.concatToFinal([finalPath], outPath, {
                format: settings.final_format,
                bitrateKbps: settings.final_bitrate_kbps,
                channels: settings.final_channels,
              });
              const meta = await audioService.getAudioMetaAfterProcess(
                podcastId,
                episodeId,
                settings.final_format,
              );
              db.prepare(
                `UPDATE episodes SET
                  audio_final_path = ?,
                  audio_source_path = ?,
                  audio_mime = ?,
                  audio_bytes = ?,
                  audio_duration_sec = ?,
                  updated_at = datetime('now')
                 WHERE id = ?`,
              ).run(
                outPath,
                outPath,
                meta.mime,
                meta.sizeBytes,
                meta.durationSec,
                episodeId,
              );

              try {
                await audioService.generateWaveformFile(
                  outPath,
                  processedDir(podcastId, episodeId),
                );
              } catch (err) {
                log.warn({ err, episodeId }, "Final waveform failed");
              }

              const procDir = processedDir(podcastId, episodeId);
              const ownerCanTranscribe =
                (
                  db
                    .prepare(
                      "SELECT COALESCE(can_transcribe, 0) AS can_transcribe FROM users WHERE id = ?",
                    )
                    .get(ownerId) as { can_transcribe: number } | undefined
                )?.can_transcribe === 1;
              if (
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
                    writeFileSync(
                      join(procDir, "transcript.srt"),
                      srtText,
                      "utf-8",
                    );
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
        })();
      });

      return reply.status(202).send({ podcast_id: podcastId });
    },
  );

  app.get(
    "/podcasts/import-status",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Podcasts"],
        summary: "Get current user’s active import",
        description:
          "Returns the in-progress import for the current user, if any. Use on load to restore the import popup after refresh.",
        response: {
          200: {
            type: "object",
            properties: {
              status: {
                type: "string",
                enum: ["idle", "pending", "importing", "done", "failed"],
              },
              podcast_id: { type: "string" },
              message: { type: "string" },
              error: { type: "string" },
              current_episode: { type: "number" },
              total_episodes: { type: "number" },
            },
            required: ["status"],
          },
        },
      },
    },
    async (request, reply) => {
      const userId = request.userId as string;
      const podcastId = activeImportByUserId.get(userId);
      if (!podcastId) {
        return reply.send({ status: "idle" });
      }
      const state = importStatusByPodcastId.get(podcastId);
      if (!state) {
        activeImportByUserId.delete(userId);
        return reply.send({ status: "idle" });
      }
      return reply.send({
        status: state.status,
        podcast_id: podcastId,
        message: state.message,
        error: state.error,
        current_episode: state.current,
        total_episodes: state.total,
      });
    },
  );

  app.get(
    "/podcasts/:id/import-status",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Podcasts"],
        summary: "Get import status",
        description:
          "Poll after POST /podcasts/import. Returns status: pending | importing | done | failed.",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        response: {
          200: {
            type: "object",
            properties: {
              status: {
                type: "string",
                enum: ["idle", "pending", "importing", "done", "failed"],
              },
              message: { type: "string" },
              error: { type: "string" },
              current_episode: { type: "number" },
              total_episodes: { type: "number" },
            },
            required: ["status"],
          },
          404: { description: "Podcast not found" },
        },
      },
    },
    async (request, reply) => {
      const { id: podcastId } = request.params as { id: string };
      if (!canAccessPodcast(request.userId as string, podcastId)) {
        return reply.status(404).send({ error: "Podcast not found" });
      }
      const state = importStatusByPodcastId.get(podcastId);
      if (!state) {
        return reply.send({
          status: "idle",
          message: undefined,
          error: undefined,
          current_episode: undefined,
          total_episodes: undefined,
        });
      }
      const response = {
        status: state.status,
        message: state.message,
        error: state.error,
        current_episode: state.current,
        total_episodes: state.total,
      };
      if (state.status === "done" || state.status === "failed") {
        importStatusByPodcastId.delete(podcastId);
        const ownerId = getPodcastOwnerId(podcastId);
        if (ownerId) activeImportByUserId.delete(ownerId);
      }
      return reply.send(response);
    },
  );
}
