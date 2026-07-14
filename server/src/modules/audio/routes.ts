import type { FastifyInstance } from "fastify";
import { statSync, unlinkSync, readFileSync, createReadStream } from "fs";
import { extname, dirname, basename, join } from "path";
import { nanoid } from "nanoid";
import send from "@fastify/send";
import { existsSync } from "fs";
import { drizzleDb } from "../../db/index.js";
import { requireAuth, requireNotReadOnly } from "../../plugins/auth.js";
import { isAllowedAudioMime } from "./utils.js";
import {
  addUserStorageDelta,
  updateEpisodeAudio,
  updateEpisodeAfterProcess,
  getEpisodeById,
  getEpisodeAudioFinalPath,
  getPodcastTitle,
  getPublicPodcastForStream,
  getPublishedEpisodeForStream,
} from "./repo.js";
import {
  canAccessEpisode,
  canEditSegments,
  canEditEpisodeOrPodcastMetadata,
  getPodcastOwnerId,
} from "../../services/access.js";
import { getLocationForIp } from "../../services/geolocation.js";
import { getClientIp, getUserAgent } from "../../services/loginAttempts.js";
import {
  clientKey,
  recordEpisodeListenIfNew,
  recordEpisodeRequest,
} from "../../services/podcastStats.js";
import {
  uploadsDir,
  processedDir,
  assertPathUnder,
  assertSafeId,
  pathRelativeToData,
  resolveDataPath,
} from "../../services/paths.js";
import * as audioService from "../../services/audio.js";
import {
  FileTooLargeError,
  streamToFileWithLimit,
  extensionFromAudioMimetype,
} from "../../services/uploads.js";
import { wouldExceedStorageLimit } from "../../services/storageLimit.js";
import {
  EPISODE_AUDIO_UPLOAD_MAX_BYTES,
  LISTEN_THRESHOLD_BYTES,
  WAVEFORM_EXTENSION,
} from "../../config.js";
import { readSettings } from "../settings/index.js";
import { userRateLimitPreHandler } from "../../services/rateLimit.js";
import { getSingleRangeRequestedLength } from "../../utils/parseRange.js";
import { isPodcastListenerUserAgent } from "../../utils/podcastTrafficClass.js";
import { podcastSourceFromUserAgent } from "../../utils/podcastSourceFromUserAgent.js";

export async function audioRoutes(app: FastifyInstance) {
  app.post(
    "/episodes/:id/audio",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Audio"],
        summary: "Upload episode audio",
        description:
          "Upload source audio (WAV/MP3, multipart). Max 500MB. Requires read-write access.",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        response: {
          200: { description: "Episode with updated audio" },
          400: { description: "No file or invalid type" },
          403: { description: "Storage limit or permission" },
          404: { description: "Episode not found" },
          500: { description: "Upload failed" },
        },
      },
    },
    async (request, reply) => {
      const { id: episodeId } = request.params as { id: string };
      try {
        assertSafeId(episodeId, "id");
      } catch (err) {
        return reply.status(400).send({ error: err instanceof Error ? err.message : "Invalid id" });
      }
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access)
        return reply.status(404).send({ error: "Episode not found" });
      if (!canEditEpisodeOrPodcastMetadata(access.role))
        return reply
          .status(403)
          .send({
            error: "You do not have permission to upload episode audio.",
          });
      const { podcastId } = access;

      const data = await request.file();
      if (!data) return reply.status(400).send({ error: "No file uploaded" });
      const mimetype = data.mimetype || "";
      if (!isAllowedAudioMime(mimetype)) {
        return reply
          .status(400)
          .send({ error: "Invalid file type. Use WAV or MP3." });
      }
      const ext = extensionFromAudioMimetype(mimetype);
      const dir = uploadsDir(podcastId, episodeId);
      const destPath = `${dir}/source.${ext}`;
      // Remove any previous source files to avoid orphaned disk usage.
      // We only ever write source.wav or source.mp3.
      let bytesRemoved = 0;
      for (const p of [`${dir}/source.wav`, `${dir}/source.mp3`]) {
        if (p === destPath) continue;
        if (!existsSync(p)) continue;
        try {
          bytesRemoved += statSync(p).size;
        } catch {
          // ignore
        }
        try {
          unlinkSync(p);
        } catch {
          // ignore
        }
      }

      let oldDestBytes = 0;
      if (existsSync(destPath)) {
        try {
          oldDestBytes = statSync(destPath).size;
        } catch {
          oldDestBytes = 0;
        }
      }

      let bytesWritten = 0;
      try {
        bytesWritten = await streamToFileWithLimit(
          data.file,
          destPath,
          EPISODE_AUDIO_UPLOAD_MAX_BYTES,
        );
      } catch (err) {
        if (err instanceof FileTooLargeError) {
          return reply.status(400).send({ error: "File too large" });
        }
        request.log.error(err);
        return reply.status(500).send({ error: "Upload failed" });
      }

      const storageUserId =
        getPodcastOwnerId(access.podcastId) ?? request.userId;
      const potentialDelta = bytesWritten - oldDestBytes - bytesRemoved;
      if (
        potentialDelta > 0 &&
        wouldExceedStorageLimit(drizzleDb, storageUserId, potentialDelta)
      ) {
        try {
          unlinkSync(destPath);
        } catch {
          /* ignore */
        }
        return reply.status(403).send({
          error:
            "You have reached your storage limit. Delete some content to free space.",
        });
      }

      let durationSec = 0;
      let sizeBytes = bytesWritten;
      let audioMime = mimetype;
      try {
        const probe = await audioService.probeAudio(destPath, dir);
        durationSec = probe.durationSec;
        sizeBytes = probe.sizeBytes;
        audioMime = probe.mime ?? mimetype;
      } catch {
        // keep defaults
      }

      const delta = (sizeBytes || 0) - oldDestBytes - bytesRemoved;
      if (delta !== 0) {
        addUserStorageDelta(storageUserId, delta);
      }

      updateEpisodeAudio(episodeId, {
        audioSourcePath: pathRelativeToData(destPath),
        audioMime: audioMime,
        audioBytes: sizeBytes,
        audioDurationSec: durationSec,
      });

      const row = getEpisodeById(episodeId);
      return row as Record<string, unknown>;
    },
  );

  app.post(
    "/episodes/:id/process-audio",
    {
      preHandler: [
        requireAuth,
        requireNotReadOnly,
        userRateLimitPreHandler({ bucket: "ffmpeg", windowMs: 1000 }),
      ],
      schema: {
        tags: ["Audio"],
        summary: "Process episode audio",
        description:
          "Transcode source to final format (MP3/M4A). Requires read-write access.",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        response: {
          200: { description: "Episode" },
          400: { description: "No source audio" },
          403: { description: "Permission denied" },
          404: { description: "Episode not found" },
          500: { description: "Processing failed" },
        },
      },
    },
    async (request, reply) => {
      const { id: episodeId } = request.params as { id: string };
      try {
        assertSafeId(episodeId, "id");
      } catch (err) {
        return reply.status(400).send({ error: err instanceof Error ? err.message : "Invalid id" });
      }
      const access = canAccessEpisode(request.userId, episodeId, {
        includeEpisode: true,
      });
      if (!access)
        return reply.status(404).send({ error: "Episode not found" });
      if (!canEditSegments(access.role))
        return reply
          .status(403)
          .send({
            error: "You do not have permission to process episode audio.",
          });
      const { podcastId, episode } = access;
      const sourcePathRaw = episode!.audioSourcePath as string | undefined;
      const sourcePath = sourcePathRaw ? resolveDataPath(sourcePathRaw) : "";
      if (!sourcePath || !existsSync(sourcePath)) {
        return reply
          .status(400)
          .send({ error: "No audio uploaded for this episode" });
      }
      try {
        const settings = readSettings();
        const finalPath = await audioService.transcodeToFinal(
          sourcePath,
          podcastId,
          episodeId,
          {
            format: settings.final_format,
            bitrateKbps: settings.final_bitrate_kbps,
            channels: settings.final_channels,
            loudnessTargetLufs: settings.loudness_target_lufs,
          },
        );
        const meta = await audioService.getAudioMetaAfterProcess(
          podcastId,
          episodeId,
          settings.final_format,
        );
        updateEpisodeAfterProcess(episodeId, {
          audioFinalPath: pathRelativeToData(finalPath),
          audioMime: meta.mime,
          audioBytes: meta.sizeBytes,
          audioDurationSec: meta.durationSec,
        });
        const row = getEpisodeById(episodeId);
        return row as Record<string, unknown>;
      } catch (err) {
        request.log.error(err);
        return reply.status(500).send({ error: "Audio processing failed" });
      }
    },
  );

  app.get(
    "/episodes/:id/final-waveform",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Audio"],
        summary: "Get final waveform",
        description: "Returns waveform JSON for processed episode audio.",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        response: {
          200: { description: "Waveform JSON" },
          400: { description: "Invalid id" },
          404: { description: "Not found" },
        },
      },
    },
    async (request, reply) => {
      const { id: episodeId } = request.params as { id: string };
      try {
        assertSafeId(episodeId, "id");
      } catch (err) {
        return reply.status(400).send({ error: err instanceof Error ? err.message : "Invalid id" });
      }
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access)
        return reply.status(404).send({ error: "Episode not found" });
      const episode = getEpisodeAudioFinalPath(episodeId);
      const audioPath = episode?.audioFinalPath
        ? resolveDataPath(episode.audioFinalPath)
        : "";
      if (!audioPath || !existsSync(audioPath))
        return reply.status(404).send({ error: "Final audio not found" });
      const base = processedDir(access.podcastId, episodeId);
      assertPathUnder(audioPath, base);
      const waveformPath = audioPath.replace(/\.[^.]+$/, WAVEFORM_EXTENSION);
      if (!existsSync(waveformPath))
        return reply.status(404).send({ error: "Waveform not found" });
      assertPathUnder(waveformPath, base);
      const json = readFileSync(waveformPath, "utf-8");
      reply
        .header("Content-Type", "application/json")
        .header("Cache-Control", "private, max-age=3600");
      return reply.send(json);
    },
  );

  app.get(
    "/episodes/:id/download",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Audio"],
        summary: "Download episode audio",
        description:
          'Download source or final audio. Query type: "source" | "final" (default).',
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        querystring: {
          type: "object",
          properties: { type: { type: "string", enum: ["source", "final"] } },
        },
        response: {
          200: { description: "Audio file" },
          206: { description: "Partial content" },
          400: { description: "Invalid id" },
          404: { description: "Not found" },
          500: { description: "Send error" },
        },
      },
    },
    async (request, reply) => {
      const { id: episodeId } = request.params as { id: string };
      try {
        assertSafeId(episodeId, "id");
      } catch (err) {
        return reply.status(400).send({ error: err instanceof Error ? err.message : "Invalid id" });
      }
      const type = (request.query as { type?: string }).type ?? "final";
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access)
        return reply.status(404).send({ error: "Episode not found" });
      const episode = getEpisodeById(episodeId);
      const pathRaw =
        type === "source"
          ? episode?.audioSourcePath ?? null
          : episode?.audioFinalPath ?? null;
      const p = pathRaw ? resolveDataPath(pathRaw) : "";
      if (!p || !existsSync(p)) {
        return reply
          .status(404)
          .send({
            error:
              type === "source"
                ? "No source audio"
                : "No processed audio. Run Process first.",
          });
      }
      const allowedBase =
        type === "source"
          ? uploadsDir(access.podcastId, episodeId)
          : processedDir(access.podcastId, episodeId);
      const safePath = assertPathUnder(p, allowedBase);
      const ext = extname(safePath) || (type === "source" ? "" : ".mp3");
      const filename =
        type === "source"
          ? `episode-source-${episodeId}${ext}`
          : `episode-${episodeId}${ext}`;
      const mime =
        (episode?.audioMime as string) || "audio/mpeg";

      const result = await send(request.raw, basename(safePath), {
        root: dirname(safePath),
        contentType: false,
        maxAge: 3600,
        acceptRanges: true,
        cacheControl: true,
      });

      if (result.type === "error") {
        const err = result.metadata.error as Error & { status?: number };
        const status = (err.status ?? 500) as 404 | 500;
        return reply
          .status(status)
          .send({ error: err.message ?? "Internal Server Error" });
      }

      reply.status(result.statusCode as 200 | 206 | 404 | 500);
      const headers = result.headers as Record<string, string>;
      for (const [key, value] of Object.entries(headers)) {
        if (value !== undefined) reply.header(key, value);
      }
      reply
        .header("Content-Type", mime)
        .header("Content-Disposition", `attachment; filename="${filename}"`);
      return reply.send(result.stream);
    },
  );

  app.get(
    "/episodes/:id/soundbite",
    {
      preHandler: [
        requireAuth,
        userRateLimitPreHandler({ bucket: "ffmpeg", windowMs: 1000 }),
      ],
      schema: {
        tags: ["Audio"],
        summary: "Download a soundbite clip from final episode audio",
        description:
          "Cuts start/duration from the final episode file (same container as the final export) and returns it as an attachment.",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        querystring: {
          type: "object",
          properties: {
            start: { type: "number" },
            duration: { type: "number" },
            title: { type: "string" },
          },
          required: ["start", "duration"],
        },
        response: {
          200: { description: "Soundbite audio file" },
          400: { description: "Invalid params" },
          404: { description: "Not found" },
          500: { description: "Extract failed" },
        },
      },
    },
    async (request, reply) => {
      const { id: episodeId } = request.params as { id: string };
      try {
        assertSafeId(episodeId, "id");
      } catch (err) {
        return reply.status(400).send({ error: err instanceof Error ? err.message : "Invalid id" });
      }
      const q = request.query as { start?: number | string; duration?: number | string; title?: string };
      const startSec = typeof q.start === "number" ? q.start : Number(q.start);
      const durationSec = typeof q.duration === "number" ? q.duration : Number(q.duration);
      if (!Number.isFinite(startSec) || startSec < 0) {
        return reply.status(400).send({ error: "start must be a number >= 0" });
      }
      if (!Number.isFinite(durationSec) || durationSec < 15 || durationSec > 120) {
        return reply.status(400).send({ error: "duration must be between 15 and 120 seconds" });
      }

      const access = canAccessEpisode(request.userId, episodeId);
      if (!access) return reply.status(404).send({ error: "Episode not found" });
      const episode = getEpisodeById(episodeId);
      const pathRaw = episode?.audioFinalPath ?? null;
      const p = pathRaw ? resolveDataPath(pathRaw) : "";
      if (!p || !existsSync(p)) {
        return reply.status(404).send({ error: "No processed audio. Build the final episode first." });
      }
      const allowedBase = processedDir(access.podcastId, episodeId);
      const safePath = assertPathUnder(p, allowedBase);
      const settings = readSettings();
      const format = settings.final_format;
      const ext = format === "m4a" ? ".m4a" : ".mp3";
      const mime = format === "m4a" ? "audio/mp4" : (episode?.audioMime as string) || "audio/mpeg";

      const titleRaw = typeof q.title === "string" ? q.title.trim() : "";
      const soundbiteName = titleRaw || "Soundbite";
      const episodeName = String(episode?.title ?? "Episode").trim() || "Episode";
      const podcastName =
        (getPodcastTitle(access.podcastId) ?? "Podcast").trim() || "Podcast";
      const rawBase = `${soundbiteName} - ${episodeName} - ${podcastName}`;
      // Safe Content-Disposition filename: strip path/control chars and quotes.
      const safeBase =
        rawBase
          .split("")
          .filter((ch) => {
            const code = ch.charCodeAt(0);
            return code >= 32 && code !== 127;
          })
          .join("")
          .replace(/[\\/:*?"<>|]/g, "-")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 180) || "soundbite";
      const filename = `${safeBase}${ext}`;
      const outPath = join(allowedBase, `soundbite_${nanoid()}${ext}`);

      try {
        await audioService.extractClipFromFinal(
          safePath,
          allowedBase,
          startSec,
          durationSec,
          outPath,
          format,
          {
            bitrateKbps: settings.final_bitrate_kbps,
            channels: settings.final_channels,
          },
        );
      } catch (err) {
        request.log.error({ err, episodeId }, "Soundbite extract failed");
        return reply.status(500).send({ error: "Failed to generate soundbite clip" });
      }

      try {
        const stream = createReadStream(outPath);
        stream.on("close", () => {
          try {
            unlinkSync(outPath);
          } catch {
            /* ignore */
          }
        });
        stream.on("error", () => {
          try {
            unlinkSync(outPath);
          } catch {
            /* ignore */
          }
        });
        reply
          .header("Content-Type", mime)
          .header("Content-Disposition", `attachment; filename="${filename}"`)
          .header("Cache-Control", "no-store");
        return reply.send(stream);
      } catch (err) {
        try {
          unlinkSync(outPath);
        } catch {
          /* ignore */
        }
        request.log.error({ err, episodeId }, "Soundbite send failed");
        return reply.status(500).send({ error: "Failed to download soundbite clip" });
      }
    },
  );

  // Public endpoint for serving episode MP3s with podcast ID in path (for RSS feed enclosures)
  // Format: /<podcastId>/episodes/<episodeId> or /<podcastId>/episodes/<episodeId>.mp3 (extension optional)
  app.get(
    "/:podcastId/episodes/:episodeId",
    {
      schema: {
        tags: ["Audio"],
        summary: "Stream episode (public)",
        description:
          "Stream episode MP3 for RSS enclosures. Public when public feeds enabled. Supports Range.",
        security: [],
        params: {
          type: "object",
          properties: {
            podcastId: { type: "string" },
            episodeId: { type: "string" },
          },
          required: ["podcastId", "episodeId"],
        },
        response: {
          200: { description: "Audio stream" },
          206: { description: "Partial content" },
          400: { description: "Invalid ID" },
          404: { description: "Not found" },
          500: { description: "Send error" },
        },
      },
    },
    async (request, reply) => {
      const settings = readSettings();
      if (!settings.public_feeds_enabled) {
        return reply.status(404).send({ error: "Not found" });
      }
      const { podcastId, episodeId: rawEpisodeId } = request.params as {
        podcastId: string;
        episodeId: string;
      };
      // Strip optional trailing file extension so enclosure URLs like .../episodes/ID.mp3 resolve to the same episode
      const episodeId =
        rawEpisodeId.replace(/\.[a-zA-Z0-9]+$/, "") || rawEpisodeId;

      try {
        assertSafeId(podcastId.trim(), "podcastId");
        assertSafeId(episodeId.trim(), "episodeId");
      } catch (err) {
        return reply.status(400).send({ error: err instanceof Error ? err.message : "Invalid podcast or episode ID" });
      }
      if (!podcastId || !podcastId.trim() || !episodeId || !episodeId.trim()) {
        return reply
          .status(400)
          .send({ error: "Invalid podcast or episode ID" });
      }

      const podcast = getPublicPodcastForStream(podcastId.trim());
      if (!podcast || podcast.publicFeedDisabled) {
        return reply.status(404).send({ error: "Not found" });
      }

      const episode = getPublishedEpisodeForStream(
        podcastId.trim(),
        episodeId.trim(),
      );
      if (!episode || episode.subscriberOnly) {
        return reply.status(404).send({ error: "Not found" });
      }

      const path = episode.audioFinalPath
        ? resolveDataPath(episode.audioFinalPath)
        : "";
      if (!path || !existsSync(path)) {
        return reply.status(404).send({ error: "Audio file not found" });
      }

      const allowedBase = processedDir(podcastId.trim(), episodeId.trim());
      const safePath = assertPathUnder(path, allowedBase);
      const mime = episode.audioMime || "audio/mpeg";

      // Stats: only for GET (not HEAD). Location lookup only for listener requests.
      // Tiny Range probes (e.g. preload=metadata bytes=0-1) do not count.
      // Full-file GETs always count as requests; listens still require LISTEN_THRESHOLD_BYTES.
      if (request.method === "GET") {
        const ip = getClientIp(request);
        const ua = getUserAgent(request);
        const isBot = !isPodcastListenerUserAgent(ua);
        const source = podcastSourceFromUserAgent(ua);

        const fileSize = statSync(safePath).size;
        const r = request.headers["range"];
        const rangeHeader =
          typeof r === "string" ? r : Array.isArray(r) ? r[0] : undefined;
        const requestedLength = getSingleRangeRequestedLength(
          rangeHeader,
          fileSize,
        );
        const isFullFile =
          requestedLength !== null && requestedLength >= fileSize;
        const countsAsRequest =
          requestedLength !== null &&
          (isFullFile || requestedLength >= LISTEN_THRESHOLD_BYTES);

        if (countsAsRequest) {
          const location = isBot
            ? null
            : ((await getLocationForIp(ip).catch(() => null)) ?? "(unknown)");
          recordEpisodeRequest(episodeId.trim(), isBot, location, source);

          const acceptLanguage =
            (request.headers["accept-language"] as string) ?? "";
          const ck = clientKey(ip, ua, acceptLanguage);
          recordEpisodeListenIfNew(
            episodeId.trim(),
            isBot,
            ck,
            requestedLength,
            source,
          );
        }
      }

      const result = await send(request.raw, basename(safePath), {
        root: dirname(safePath),
        contentType: false, // set manually from episode.audio_mime
        maxAge: 3600,
        acceptRanges: true,
        cacheControl: true,
      });

      if (result.type === "error") {
        const err = result.metadata.error as Error & { status?: number };
        const status = (err.status ?? 500) as 400 | 404 | 500;
        const message = err.message ?? "Internal Server Error";
        return reply.status(status).send({ error: message });
      }

      reply.status(result.statusCode as 200 | 206 | 404 | 500);
      const headers = result.headers as Record<string, string>;
      for (const [key, value] of Object.entries(headers)) {
        if (value !== undefined) reply.header(key, value);
      }
      reply.header("Content-Type", mime);
      return reply.send(result.stream);
    },
  );

  // Public episode video stream (same access as public audio: published, not subscriber-only)
  app.get(
    "/:podcastId/episodes/:episodeId/video",
    {
      schema: {
        tags: ["Audio"],
        summary: "Stream episode video (public)",
        description:
          "Stream episode video for public feed. Same visibility as public audio. Supports Range.",
        security: [],
        params: {
          type: "object",
          properties: {
            podcastId: { type: "string" },
            episodeId: { type: "string" },
          },
          required: ["podcastId", "episodeId"],
        },
        response: {
          200: { description: "Video stream" },
          206: { description: "Partial content" },
          400: { description: "Invalid ID" },
          404: { description: "Not found" },
          500: { description: "Server error" },
        },
      },
    },
    async (request, reply) => {
      const settings = readSettings();
      if (!settings.public_feeds_enabled) {
        return reply.status(404).send({ error: "Not found" });
      }
      const { podcastId, episodeId: rawEpisodeId } = request.params as {
        podcastId: string;
        episodeId: string;
      };
      const episodeId = rawEpisodeId.replace(/\.[a-zA-Z0-9]+$/, "") || rawEpisodeId;
      try {
        assertSafeId(podcastId.trim(), "podcastId");
        assertSafeId(episodeId.trim(), "episodeId");
      } catch (err) {
        return reply.status(400).send({ error: err instanceof Error ? err.message : "Invalid podcast or episode ID" });
      }
      if (!podcastId?.trim() || !episodeId?.trim()) {
        return reply.status(400).send({ error: "Invalid podcast or episode ID" });
      }
      const podcast = getPublicPodcastForStream(podcastId.trim());
      if (!podcast || podcast.publicFeedDisabled) {
        return reply.status(404).send({ error: "Not found" });
      }
      const episode = getPublishedEpisodeForStream(podcastId.trim(), episodeId.trim());
      if (!episode || episode.subscriberOnly || !episode.videoFinalPath) {
        return reply.status(404).send({ error: "Not found" });
      }
      const path = resolveDataPath(episode.videoFinalPath);
      if (!path || !existsSync(path)) {
        return reply.status(404).send({ error: "Not found" });
      }
      const allowedBase = processedDir(podcastId.trim(), episodeId.trim());
      const safePath = assertPathUnder(path, allowedBase);
      const result = await send(request.raw, basename(safePath), {
        root: dirname(safePath),
        contentType: false,
        maxAge: 3600,
        acceptRanges: true,
        cacheControl: true,
      });
      if (result.type === "error") {
        const err = result.metadata.error as Error & { status?: number };
        const errStatus = (err.status ?? 404) as 404 | 500;
        return reply.status(errStatus).send({ error: "Not found" });
      }
      reply.status(result.statusCode as 200 | 206 | 404 | 500);
      const headers = result.headers as Record<string, string>;
      for (const [key, value] of Object.entries(headers)) {
        if (value !== undefined) reply.header(key, value);
      }
      reply.header("Content-Type", "video/mp4");
      return reply.send(result.stream);
    },
  );
}
