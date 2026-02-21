import type { FastifyInstance } from "fastify";
import send from "@fastify/send";
import { createReadStream, existsSync, statSync, unlinkSync, writeFileSync } from "fs";
import { basename, dirname, extname } from "path";
import { requireAuth, requireNotReadOnly } from "../../plugins/auth.js";
import { canAccessEpisode, canEditSegments, getPodcastOwnerId } from "../../services/access.js";
import {
  getDataDir,
  processedDir,
  episodeVideoPath,
  episodeVideoCoverPath,
  resolveDataPath,
  pathRelativeToData,
  assertPathUnder,
  assertResolvedPathUnder,
} from "../../services/paths.js";
import { broadcastToEpisode } from "../../services/episodeBroadcast.js";
import { segmentEpisodeIdParamSchema, generateVideoBodySchema } from "@harborfm/shared";
import { userRateLimitPreHandler } from "../../services/rateLimit.js";
import { videoGenStatusByEpisode, videoGenErrorByEpisode, videoGenLockedEpisodes } from "./utils.js";
import * as repo from "./repo.js";
import * as episodesRepo from "../episodes/repo.js";
import { sqlNow } from "../../db/utils.js";
import { drizzleDb } from "../../db/index.js";
import { wouldExceedStorageLimit } from "../../services/storageLimit.js";
import { generateEpisodeVideo, estimateEpisodeVideoBytes } from "../../services/videoGeneration.js";
import { ARTWORK_MAX_BYTES, ARTWORK_MAX_MB, ALLOW_VIDEO_GENERATION } from "../../config.js";
import { MIMETYPE_TO_EXT } from "../../utils/artwork.js";

const VIDEO_COVER_EXTS = ["jpg", "jpeg", "png", "webp"];

/** Generous rate limit for video operations: 10 requests per 2 minutes per user. */
const VIDEO_RATE_LIMIT = { bucket: "video", windowMs: 120_000, max: 10 };

/** Validate image magic bytes match claimed extension (jpg, png, webp). Returns true if valid. */
function validateVideoCoverMagicBytes(buffer: Buffer, ext: string): boolean {
  const e = ext === "jpeg" ? "jpg" : ext;
  if (buffer.length < 12) return false;
  if (e === "jpg") {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (e === "png") {
    return (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a
    );
  }
  if (e === "webp") {
    return (
      buffer[0] === 0x52 &&
      buffer[1] === 0x49 &&
      buffer[2] === 0x46 &&
      buffer[3] === 0x46 &&
      buffer[8] === 0x57 &&
      buffer[9] === 0x45 &&
      buffer[10] === 0x42 &&
      buffer[11] === 0x50
    );
  }
  return false;
}

/** Safe filename for Content-Disposition: only alphanumeric, hyphen, underscore. Prevents header injection. */
function safeDownloadFilename(episodeId: string, ext: string): string {
  const safeId = episodeId.replace(/[^a-zA-Z0-9_-]/g, "") || "video";
  return `episode-${safeId}${ext}`;
}

/** Return path to video cover image if one exists in processed dir, else null. */
function getVideoCoverPath(
  podcastId: string,
  episodeId: string,
): string | null {
  for (const ext of VIDEO_COVER_EXTS) {
    const p = episodeVideoCoverPath(podcastId, episodeId, ext);
    if (existsSync(p)) {
      try {
        assertPathUnder(p, getDataDir());
        return p;
      } catch {
        return null;
      }
    }
  }
  return null;
}

export async function registerVideoRoutes(app: FastifyInstance) {
  app.get(
    "/episodes/:id/video-status",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Segments"],
        summary: "Get video generation status",
        description:
          "Returns whether a video generation is in progress, done, or failed. Poll every 1–2s after starting.",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        response: {
          200: {
            description: "Video status",
            type: "object",
            properties: {
              status: {
                type: "string",
                enum: ["idle", "generating", "done", "failed"],
              },
              error: { type: "string" },
            },
            required: ["status"],
          },
          400: { description: "Validation failed" },
          404: { description: "Episode not found" },
        },
      },
    },
    async (request, reply) => {
      const parsed = segmentEpisodeIdParamSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: parsed.error.issues[0]?.message ?? "Validation failed", details: parsed.error.flatten() });
      }
      const { id: episodeId } = parsed.data;
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access)
        return reply.status(404).send({ error: "Episode not found" });
      const status = videoGenStatusByEpisode.get(episodeId) ?? "idle";
      const error =
        status === "failed"
          ? (videoGenErrorByEpisode.get(episodeId) ?? "Video generation failed")
          : undefined;
      // Clear only "done" so UI can show success; keep "failed" until user starts a new generation
      if (status === "done") {
        videoGenStatusByEpisode.delete(episodeId);
        videoGenErrorByEpisode.delete(episodeId);
      }
      return reply.send({ status, error });
    },
  );

  app.get(
    "/episodes/:id/video-cover",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Segments"],
        summary: "Get video cover image",
        description: "Returns the current video cover image for the episode (for preview). 404 if none.",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        response: {
          200: { description: "Image file" },
          400: { description: "Validation failed" },
          404: { description: "No video cover" },
        },
      },
    },
    async (request, reply) => {
      const parsed = segmentEpisodeIdParamSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: parsed.error.issues[0]?.message ?? "Validation failed", details: parsed.error.flatten() });
      }
      const { id: episodeId } = parsed.data;
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access)
        return reply.status(404).send({ error: "Episode not found" });
      const row = repo.getEpisodeForTranscript(episodeId);
      if (!row) return reply.status(404).send({ error: "Episode not found" });
      const coverPath = getVideoCoverPath(row.podcastId, episodeId);
      if (!coverPath) return reply.status(404).send({ error: "No video cover" });
      const ext = (basename(coverPath).split(".").pop() ?? "").toLowerCase();
      const contentType =
        ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
      return reply.type(contentType).send(createReadStream(coverPath));
    },
  );

  app.post(
    "/episodes/:id/generate-video",
    {
      preHandler: [requireAuth, requireNotReadOnly, userRateLimitPreHandler(VIDEO_RATE_LIMIT)],
      schema: {
        tags: ["Segments"],
        summary: "Start video generation",
        description:
          "Generate a video from the final episode audio and a background image (episode artwork or uploaded video cover). Returns 202; status updates are sent over the episode WebSocket (videoGenerationStarted / videoGenerated).",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        body: {
          type: "object",
          properties: {
            x: { type: "number", minimum: 0, maximum: 1, description: "X position 0–1 (0.5 = center)" },
            y: { type: "number", minimum: 0, maximum: 1, description: "Y position 0–1 (0.5 = center)" },
            width: { type: "number", minimum: 0, maximum: 1, description: "Spectrum width 0–1 (fraction of video width)" },
            amplitude: { type: "number", minimum: 0, maximum: 2 },
            style: { type: "string", enum: ["spectrum-rainbow", "spectrum-magma", "spectrum-viridis"] },
            strokeWidth: { type: "integer", minimum: 1, maximum: 30, description: "Sine/circle: stroke px; bars/dots: count" },
            smoothing: { type: "number", minimum: 0, maximum: 1, description: "Smoothing 0–1 (how fast the line reacts)" },
            resolution: { type: "string", enum: ["480p", "720p", "1080p"] },
            orientation: { type: "string", enum: ["landscape", "portrait"] },
            waveformType: { type: "string", enum: ["sine", "bars", "circle", "dots"] },
            color: { type: "string", maxLength: 100, description: "CSS color (hex, rgb, rgba, or gradient)" },
          },
          required: ["x", "y", "width", "amplitude"],
        },
        response: {
          202: {
            description: "Generation started",
            type: "object",
            properties: { status: { type: "string", enum: ["generating"] } },
            required: ["status"],
          },
          400: { description: "Missing image or final audio, or not enough disk space" },
          403: { description: "Permission denied" },
          404: { description: "Episode not found" },
          409: {
            description: "Generation already in progress",
            type: "object",
            properties: { status: { type: "string" }, message: { type: "string" } },
          },
          503: { description: "Video generation disabled (ALLOW_VIDEO_GENERATION not set)" },
        },
      },
    },
    async (request, reply) => {
      const parsed = segmentEpisodeIdParamSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: parsed.error.issues[0]?.message ?? "Validation failed", details: parsed.error.flatten() });
      }
      const { id: episodeId } = parsed.data;
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access)
        return reply.status(404).send({ error: "Episode not found" });
      if (!canEditSegments(access.role)) {
        return reply
          .status(403)
          .send({ error: "You do not have permission to edit this episode." });
      }
      if (!ALLOW_VIDEO_GENERATION) {
        return reply.status(503).send({
          error: "Video generation is disabled. Set ALLOW_VIDEO_GENERATION=true to enable (requires node-canvas).",
        });
      }
      if (!repo.getUserCanGenerateVideo(request.userId)) {
        return reply.status(403).send({
          error: "You do not have permission to generate video. An admin can enable this for your account.",
        });
      }
      const bodyParsed = generateVideoBodySchema.safeParse(request.body);
      if (!bodyParsed.success) {
        return reply
          .status(400)
          .send({ error: bodyParsed.error.issues[0]?.message ?? "Validation failed", details: bodyParsed.error.flatten() });
      }
      const row = repo.getEpisodeForTranscript(episodeId);
      if (!row || !row.audioFinalPath) {
        return reply.status(400).send({ error: "Episode has no final audio. Build the final episode first." });
      }
      const audioPath = resolveDataPath(row.audioFinalPath);
      if (!existsSync(audioPath)) {
        return reply.status(400).send({ error: "Final audio file not found." });
      }
      const podcastId = row.podcastId;
      const episode = episodesRepo.getById(episodeId);
      let imagePath: string | null = getVideoCoverPath(podcastId, episodeId);
      if (!imagePath) {
        const artworkPath = episode?.artworkPath;
        if (artworkPath) {
          imagePath = resolveDataPath(artworkPath);
          if (!existsSync(imagePath)) imagePath = null;
        }
      }
      if (!imagePath) {
        return reply.status(400).send({
          error: "No background image. Upload episode artwork or a video cover image first.",
        });
      }
      if (videoGenLockedEpisodes.has(episodeId) || videoGenStatusByEpisode.get(episodeId) === "generating") {
        return reply.status(409).send({
          status: "generating",
          message: "Video generation is already in progress.",
        });
      }

      const durationSec = episode?.audioDurationSec ?? 3600;
      const options = bodyParsed.data;
      const estimatedBytes = estimateEpisodeVideoBytes(durationSec, options.resolution);
      let existingSize = 0;
      if (episode?.videoFinalPath) {
        const existingPath = resolveDataPath(episode.videoFinalPath);
        if (existsSync(existingPath)) {
          existingSize = statSync(existingPath).size;
        }
      }
      const bytesToReserve = Math.max(0, estimatedBytes - existingSize);
      const ownerId = getPodcastOwnerId(podcastId);
      if (ownerId && wouldExceedStorageLimit(drizzleDb, ownerId, bytesToReserve)) {
        return reply.status(400).send({
          error: "Not enough disk space to generate the video. Free up space and try again.",
        });
      }
      if (ownerId) {
        if (existingSize > 0) {
          repo.subtractUserDiskBytes(ownerId, existingSize);
        }
        repo.addUserDiskBytes(ownerId, estimatedBytes);
      }

      videoGenLockedEpisodes.add(episodeId);
      const imagePathForVideo = imagePath;
      const estimatedBytesForTask = estimatedBytes;
      const existingVideoBytes = existingSize;
      videoGenStatusByEpisode.set(episodeId, "generating");
      videoGenErrorByEpisode.delete(episodeId);
      const log = request.log;
      broadcastToEpisode(episodeId, { type: "videoGenerationStarted" });
      setImmediate(() => {
        (async () => {
          try {
            log.info({ episodeId }, "Video generation task started");
            if (!existsSync(imagePathForVideo)) {
              throw new Error("Background image not found. Upload a video cover photo first.");
            }
            if (!existsSync(audioPath)) {
              throw new Error("Final audio file not found. Build the final episode first.");
            }
            await generateEpisodeVideo(podcastId, episodeId, {
              imagePath: imagePathForVideo,
              audioPath,
              x: options.x,
              y: options.y,
              width: options.width,
              amplitude: options.amplitude,
              style: options.style,
              strokeWidth: options.strokeWidth,
              smoothing: options.smoothing,
              resolution: options.resolution,
              orientation: options.orientation,
              waveformType: options.waveformType,
              color: options.color,
            });
            const outPath = episodeVideoPath(podcastId, episodeId);
            const actualSize = statSync(outPath).size;
            if (ownerId) {
              const delta = actualSize - estimatedBytesForTask;
              if (delta > 0) {
                repo.addUserDiskBytes(ownerId, delta);
              } else if (delta < 0) {
                repo.subtractUserDiskBytes(ownerId, -delta);
              }
            }
            const relativePath = pathRelativeToData(outPath);
            episodesRepo.updateEpisode(episodeId, {
              videoFinalPath: relativePath,
              updatedAt: sqlNow(),
            });
            videoGenStatusByEpisode.set(episodeId, "done");
            broadcastToEpisode(episodeId, { type: "videoGenerated", status: "done" });
            log.info({ episodeId }, "Video generation done");
          } catch (err) {
            if (ownerId) {
              repo.subtractUserDiskBytes(ownerId, estimatedBytesForTask);
              if (existingVideoBytes > 0) {
                repo.addUserDiskBytes(ownerId, existingVideoBytes);
              }
            }
            const ffmpegStderr = (err as { ffmpegStderr?: string })?.ffmpegStderr;
            if (ffmpegStderr != null) {
              log.error({ err, ffmpegStderr }, "Video generation failed");
            } else {
              log.error(err);
            }
            const msg = err instanceof Error ? err.message : "Video generation failed";
            videoGenErrorByEpisode.set(episodeId, msg);
            videoGenStatusByEpisode.set(episodeId, "failed");
            broadcastToEpisode(episodeId, { type: "videoGenerated", status: "failed", error: msg });
          } finally {
            videoGenLockedEpisodes.delete(episodeId);
          }
        })().catch((err) => {
          if (ownerId) {
            repo.subtractUserDiskBytes(ownerId, estimatedBytesForTask);
            if (existingVideoBytes > 0) {
              repo.addUserDiskBytes(ownerId, existingVideoBytes);
            }
          }
          log.error(err, "Video generation threw (unhandled)");
          videoGenErrorByEpisode.set(episodeId, err instanceof Error ? err.message : "Video generation failed");
          videoGenStatusByEpisode.set(episodeId, "failed");
          broadcastToEpisode(episodeId, { type: "videoGenerated", status: "failed", error: err instanceof Error ? err.message : "Video generation failed" });
          videoGenLockedEpisodes.delete(episodeId);
        });
      });
      return reply.status(202).send({ status: "generating" });
    },
  );

  app.post(
    "/episodes/:id/video-cover",
    {
      preHandler: [requireAuth, requireNotReadOnly, userRateLimitPreHandler(VIDEO_RATE_LIMIT)],
      schema: {
        tags: ["Segments"],
        summary: "Upload video cover image",
        description:
          "Upload an image to use as the background for video generation. Optional; if not set, episode artwork is used. Max 5MB.",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        response: {
          200: { description: "Video cover uploaded" },
          400: { description: "No file or not image" },
          403: { description: "Permission denied" },
          404: { description: "Episode not found" },
        },
      },
    },
    async (request, reply) => {
      const parsed = segmentEpisodeIdParamSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: parsed.error.issues[0]?.message ?? "Validation failed", details: parsed.error.flatten() });
      }
      const { id: episodeId } = parsed.data;
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access)
        return reply.status(404).send({ error: "Episode not found" });
      if (!canEditSegments(access.role)) {
        return reply.status(403).send({ error: "You do not have permission to edit this episode." });
      }
      const row = repo.getEpisodeForTranscript(episodeId);
      if (!row) return reply.status(404).send({ error: "Episode not found" });
      const podcastId = row.podcastId;
      const data = await request.file();
      if (!data) return reply.status(400).send({ error: "No file uploaded" });
      const mimetype = (data.mimetype || "").toLowerCase();
      if (!mimetype.startsWith("image/"))
        return reply.status(400).send({ error: "Not an image" });
      const ext = MIMETYPE_TO_EXT[mimetype] ?? "jpg";
      processedDir(podcastId, episodeId);
      const destPath = episodeVideoCoverPath(podcastId, episodeId, ext === "jpeg" ? "jpg" : ext);
      assertResolvedPathUnder(destPath, getDataDir());
      const buffer = await data.toBuffer();
      if (buffer.length > ARTWORK_MAX_BYTES) {
        return reply
          .status(400)
          .send({ error: `Image too large (max ${ARTWORK_MAX_MB}MB)` });
      }
      const extForValidation = ext === "jpeg" ? "jpg" : ext;
      if (!validateVideoCoverMagicBytes(buffer, extForValidation)) {
        return reply.status(400).send({ error: "File is not a valid image (invalid or unsupported format)" });
      }
      for (const e of VIDEO_COVER_EXTS) {
        const p = episodeVideoCoverPath(podcastId, episodeId, e);
        if (existsSync(p)) {
          try {
            unlinkSync(p);
          } catch {
            // ignore
          }
        }
      }
      writeFileSync(destPath, buffer);
      return reply.send({ ok: true });
    },
  );

  app.get(
    "/episodes/:id/download-video",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Segments"],
        summary: "Download episode video",
        description: "Download the generated video for the episode.",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        response: {
          200: { description: "Video file" },
          206: { description: "Partial content" },
          400: { description: "Validation failed" },
          404: { description: "No video" },
        },
      },
    },
    async (request, reply) => {
      const parsed = segmentEpisodeIdParamSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: parsed.error.issues[0]?.message ?? "Validation failed", details: parsed.error.flatten() });
      }
      const { id: episodeId } = parsed.data;
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access)
        return reply.status(404).send({ error: "Episode not found" });
      const episode = episodesRepo.getById(episodeId);
      const pathRaw = episode?.videoFinalPath ?? null;
      const p = pathRaw ? resolveDataPath(pathRaw) : "";
      if (!p || !existsSync(p)) {
        return reply.status(404).send({ error: "No video. Generate a video first." });
      }
      const base = processedDir(access.podcastId, episodeId);
      const safePath = assertPathUnder(p, base);
      const ext = extname(safePath) || ".mp4";
      const filename = safeDownloadFilename(episodeId, ext);
      const result = await send(request.raw, basename(safePath), {
        root: dirname(safePath),
        contentType: false,
        maxAge: 3600,
        acceptRanges: true,
        cacheControl: true,
      });
      if (result.type === "error") {
        return reply.status(404).send({ error: "Not found" });
      }
      const code = result.statusCode as 200 | 206 | 404;
      reply.status(code);
      const headers = result.headers as Record<string, string>;
      for (const [key, value] of Object.entries(headers)) {
        if (value !== undefined) reply.header(key, value);
      }
      reply.header("Content-Type", "video/mp4");
      reply.header("Content-Disposition", `attachment; filename="${filename}"`);
      return reply.send(result.stream);
    },
  );
}
