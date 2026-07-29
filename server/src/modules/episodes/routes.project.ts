import type { FastifyInstance } from "fastify";
import type { Readable } from "stream";
import { createReadStream, existsSync, statSync } from "fs";
import { requireAuth, requireNotReadOnly } from "../../plugins/auth.js";
import {
  canAccessEpisode,
  canAccessPodcast,
  canEditEpisodeOrPodcastMetadata,
  canEditSegments,
  getPodcastRole,
} from "../../services/access.js";
import {
  IMPORT_PROJECT_RATE_LIMIT_WINDOW_MS,
  MULTIPART_MAX_BYTES,
  PROJECT_IMPORT_CHUNK_BODY_LIMIT,
  PROJECT_IMPORT_CHUNK_BYTES,
} from "../../config.js";
import { assertSafeId } from "../../services/paths.js";
import { userRateLimitPreHandler } from "../../services/rateLimit.js";
import { writeRssFile, deleteTokenFeedTemplateFile } from "../../services/rss.js";
import { notifyWebSubHub } from "../../services/websub.js";
import {
  appendChunkedUpload,
  ChunkTooLargeError,
  createChunkedUpload,
  finalizeChunkedUpload,
  getChunkedUpload,
} from "../../services/chunkedUpload.js";
import { FileTooLargeError } from "../../services/uploads.js";
import * as repo from "./repo.js";
import {
  getOrBuildProjectZip,
  getProjectExportStatus,
  startProjectExport,
} from "./projectExport.js";
import {
  getProjectImportStatus,
  removeTempPath,
  startProjectImport,
  streamTempZip,
} from "./projectImport.js";

function parsePositiveInt(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.trunc(raw);
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number(raw);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return null;
}

function afterEpisodeImportRss(podcastId: string): void {
  try {
    writeRssFile(podcastId, null);
    deleteTokenFeedTemplateFile(podcastId);
    notifyWebSubHub(podcastId, null);
  } catch {
    // non-fatal
  }
}

function assertCanImportEpisodeProject(
  userId: string | undefined,
  podcastId: string,
): { ok: true } | { ok: false; status: 403 | 404; error: string } {
  if (!userId || !canAccessPodcast(userId, podcastId)) {
    return { ok: false, status: 404, error: "Podcast not found" };
  }
  const role = getPodcastRole(userId, podcastId);
  if (!canEditEpisodeOrPodcastMetadata(role)) {
    return {
      ok: false,
      status: 403,
      error: "Only managers and the owner can import project zips",
    };
  }
  const { maxEpisodes } = repo.getCreateLimit(podcastId);
  if (maxEpisodes != null && maxEpisodes > 0) {
    const count = repo.countByPodcastId(podcastId);
    if (count >= maxEpisodes) {
      return {
        ok: false,
        status: 403,
        error: `This show has reached its limit of ${maxEpisodes} episode${maxEpisodes === 1 ? "" : "s"}. You cannot import more.`,
      };
    }
  }
  return { ok: true };
}

export async function registerProjectRoutes(app: FastifyInstance) {
  app.addContentTypeParser(
    "application/octet-stream",
    function (_request, payload, done) {
      done(null, payload);
    },
  );

  app.post(
    "/episodes/:episodeId/project-export/prepare",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Episodes"],
        summary: "Start episode project zip build",
        description:
          "Start building a HarborFM project zip in the background. Returns 202; poll GET project-export/status until ready or failed, then GET project-export to download.",
        params: {
          type: "object",
          properties: { episodeId: { type: "string" } },
          required: ["episodeId"],
        },
        response: {
          202: {
            description: "Build started",
            type: "object",
            properties: { status: { type: "string", enum: ["building"] } },
            required: ["status"],
          },
          409: {
            description: "Build already in progress",
            type: "object",
            properties: {
              status: { type: "string" },
              message: { type: "string" },
            },
          },
          400: { description: "Invalid episodeId" },
          403: { description: "Forbidden" },
          404: { description: "Episode not found" },
        },
      },
    },
    async (request, reply) => {
      const { episodeId } = request.params as { episodeId: string };
      try {
        assertSafeId(episodeId, "episodeId");
      } catch (err) {
        return reply
          .status(400)
          .send({ error: err instanceof Error ? err.message : "Invalid episodeId" });
      }
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access) {
        return reply.status(404).send({ error: "Episode not found" });
      }
      if (!canEditSegments(access.role)) {
        return reply.status(403).send({ error: "Editors and above can download project zips" });
      }
      const episode = repo.getById(episodeId);
      if (!episode) {
        return reply.status(404).send({ error: "Episode not found" });
      }
      const started = startProjectExport(episodeId, access.podcastId);
      if (!started) {
        return reply.status(409).send({
          status: "building",
          message: "Project export already in progress",
        });
      }
      return reply.status(202).send({ status: "building" });
    },
  );

  app.get(
    "/episodes/:episodeId/project-export/status",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Episodes"],
        summary: "Get episode project zip build status",
        description:
          "Poll after POST project-export/prepare until ready or failed.",
        params: {
          type: "object",
          properties: { episodeId: { type: "string" } },
          required: ["episodeId"],
        },
        response: {
          200: {
            description: "Export status",
            type: "object",
            properties: {
              status: {
                type: "string",
                enum: ["idle", "building", "ready", "failed"],
              },
              error: { type: "string" },
            },
            required: ["status"],
          },
          400: { description: "Invalid episodeId" },
          403: { description: "Forbidden" },
          404: { description: "Episode not found" },
        },
      },
    },
    async (request, reply) => {
      const { episodeId } = request.params as { episodeId: string };
      try {
        assertSafeId(episodeId, "episodeId");
      } catch (err) {
        return reply
          .status(400)
          .send({ error: err instanceof Error ? err.message : "Invalid episodeId" });
      }
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access) {
        return reply.status(404).send({ error: "Episode not found" });
      }
      if (!canEditSegments(access.role)) {
        return reply.status(403).send({ error: "Editors and above can download project zips" });
      }
      return reply.send(getProjectExportStatus(episodeId));
    },
  );

  app.get(
    "/episodes/:episodeId/project-export",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Episodes"],
        summary: "Download episode project zip",
        description:
          "Download a HarborFM project zip (episode metadata, segments, multitrack recordings, library assets). Editors and above only. Prefer POST prepare + status poll first; this endpoint awaits any in-flight build (singleflight) then streams the zip.",
        params: {
          type: "object",
          properties: { episodeId: { type: "string" } },
          required: ["episodeId"],
        },
        response: {
          200: { description: "Project zip attachment" },
          400: { description: "Invalid episodeId" },
          403: { description: "Forbidden" },
          404: { description: "Episode not found" },
          500: { description: "Export failed" },
        },
      },
    },
    async (request, reply) => {
      const { episodeId } = request.params as { episodeId: string };
      try {
        assertSafeId(episodeId, "episodeId");
      } catch (err) {
        return reply
          .status(400)
          .send({ error: err instanceof Error ? err.message : "Invalid episodeId" });
      }
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access) {
        return reply.status(404).send({ error: "Episode not found" });
      }
      if (!canEditSegments(access.role)) {
        return reply.status(403).send({ error: "Editors and above can download project zips" });
      }
      const episode = repo.getById(episodeId);
      if (!episode) {
        return reply.status(404).send({ error: "Episode not found" });
      }

      try {
        const { zipPath, filename } = await getOrBuildProjectZip(
          episodeId,
          access.podcastId,
        );
        if (!existsSync(zipPath)) {
          return reply.status(500).send({ error: "Failed to build project zip" });
        }
        const size = statSync(zipPath).size;
        reply
          .header("Content-Type", "application/zip")
          .header(
            "Content-Disposition",
            `attachment; filename="${filename.replace(/"/g, "")}"`,
          )
          .header("Content-Length", String(size));
        return reply.send(createReadStream(zipPath));
      } catch (err) {
        request.log.error({ err }, "project-export failed");
        return reply.status(500).send({
          error: err instanceof Error ? err.message : "Failed to export project",
        });
      }
    },
  );

  app.get(
    "/podcasts/:podcastId/episodes/import-project/status",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Episodes"],
        summary: "Get episode project import status",
        description:
          "Poll after POST import-project (202) until done or failed.",
        params: {
          type: "object",
          properties: { podcastId: { type: "string" } },
          required: ["podcastId"],
        },
        response: {
          200: {
            description: "Import status",
            type: "object",
            properties: {
              status: {
                type: "string",
                enum: ["idle", "importing", "done", "failed"],
              },
              episodeId: { type: "string" },
              slug: { type: "string" },
              error: { type: "string" },
              warning: { type: "string" },
            },
            required: ["status"],
          },
          400: { description: "Invalid podcastId" },
          403: { description: "Forbidden" },
          404: { description: "Podcast not found" },
        },
      },
    },
    async (request, reply) => {
      const { podcastId } = request.params as { podcastId: string };
      try {
        assertSafeId(podcastId, "podcastId");
      } catch (err) {
        return reply
          .status(400)
          .send({ error: err instanceof Error ? err.message : "Invalid podcastId" });
      }
      if (!canAccessPodcast(request.userId, podcastId)) {
        return reply.status(404).send({ error: "Podcast not found" });
      }
      const role = getPodcastRole(request.userId, podcastId);
      if (!canEditEpisodeOrPodcastMetadata(role)) {
        return reply.status(403).send({
          error: "Only managers and the owner can import project zips",
        });
      }
      return reply.send(getProjectImportStatus(podcastId));
    },
  );

  app.post(
    "/podcasts/:podcastId/episodes/import-project/upload",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Episodes"],
        summary: "Start chunked episode project upload",
        description:
          "Create a chunked upload session for a large project zip. Then PUT chunks and POST finish. Prefer this over single-shot POST import-project for large files.",
        params: {
          type: "object",
          properties: { podcastId: { type: "string" } },
          required: ["podcastId"],
        },
        body: {
          type: "object",
          properties: {
            totalBytes: { type: "number" },
            totalChunks: { type: "number" },
            filename: { type: "string" },
          },
          required: ["totalBytes", "totalChunks"],
        },
        response: {
          200: {
            description: "Upload session created",
            type: "object",
            properties: {
              uploadId: { type: "string" },
              chunkBytes: { type: "number" },
            },
            required: ["uploadId", "chunkBytes"],
          },
          400: { description: "Invalid request" },
          403: { description: "Forbidden" },
          404: { description: "Not found" },
        },
      },
    },
    async (request, reply) => {
      const { podcastId } = request.params as { podcastId: string };
      try {
        assertSafeId(podcastId, "podcastId");
      } catch (err) {
        return reply
          .status(400)
          .send({ error: err instanceof Error ? err.message : "Invalid podcastId" });
      }
      const gate = assertCanImportEpisodeProject(request.userId, podcastId);
      if (!gate.ok) {
        return reply.status(gate.status).send({ error: gate.error });
      }
      const body = request.body as {
        totalBytes?: number;
        totalChunks?: number;
        filename?: string;
      };
      const totalBytes = parsePositiveInt(body.totalBytes);
      const totalChunks = parsePositiveInt(body.totalChunks);
      if (totalBytes == null || totalChunks == null) {
        return reply.status(400).send({
          error: "totalBytes and totalChunks are required",
        });
      }
      try {
        const { uploadId } = createChunkedUpload({
          userId: request.userId!,
          purpose: `episode-import:${podcastId}`,
          totalBytes,
          totalChunks,
          filename: body.filename,
        });
        return reply.send({
          uploadId,
          chunkBytes: PROJECT_IMPORT_CHUNK_BYTES,
        });
      } catch (err) {
        return reply.status(400).send({
          error: err instanceof Error ? err.message : "Failed to start upload",
        });
      }
    },
  );

  app.put(
    "/podcasts/:podcastId/episodes/import-project/upload/:uploadId/chunks/:chunkIndex",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      bodyLimit: PROJECT_IMPORT_CHUNK_BODY_LIMIT,
      schema: {
        tags: ["Episodes"],
        summary: "Upload one episode project zip chunk",
        params: {
          type: "object",
          properties: {
            podcastId: { type: "string" },
            uploadId: { type: "string" },
            chunkIndex: { type: "string" },
          },
          required: ["podcastId", "uploadId", "chunkIndex"],
        },
        querystring: {
          type: "object",
          properties: {
            totalChunks: { type: "string" },
            totalBytes: { type: "string" },
          },
          required: ["totalChunks", "totalBytes"],
        },
      },
    },
    async (request, reply) => {
      const { podcastId, uploadId, chunkIndex: chunkIndexRaw } =
        request.params as {
          podcastId: string;
          uploadId: string;
          chunkIndex: string;
        };
      try {
        assertSafeId(podcastId, "podcastId");
      } catch (err) {
        return reply
          .status(400)
          .send({ error: err instanceof Error ? err.message : "Invalid podcastId" });
      }
      const gate = assertCanImportEpisodeProject(request.userId, podcastId);
      if (!gate.ok) {
        return reply.status(gate.status).send({ error: gate.error });
      }
      const session = getChunkedUpload(uploadId, request.userId!);
      if (!session || session.purpose !== `episode-import:${podcastId}`) {
        return reply.status(404).send({ error: "Upload not found or expired" });
      }
      const chunkIndex = parsePositiveInt(chunkIndexRaw);
      const q = request.query as { totalChunks?: string; totalBytes?: string };
      const totalChunks = parsePositiveInt(q.totalChunks);
      const totalBytes = parsePositiveInt(q.totalBytes);
      if (chunkIndex == null || totalChunks == null || totalBytes == null) {
        return reply.status(400).send({
          error: "chunkIndex, totalChunks, and totalBytes are required",
        });
      }
      const lenHeader = request.headers["content-length"];
      const chunkLength =
        typeof lenHeader === "string" && Number.isFinite(Number(lenHeader))
          ? Number(lenHeader)
          : undefined;
      const stream = request.body as Readable;
      if (!stream || typeof stream.pipe !== "function") {
        return reply
          .status(400)
          .send({ error: "Expected application/octet-stream body" });
      }
      try {
        const result = await appendChunkedUpload(uploadId, request.userId!, {
          chunkIndex,
          totalChunks,
          totalBytes,
          body: stream,
          chunkLength,
          maxChunkBytes: PROJECT_IMPORT_CHUNK_BODY_LIMIT,
        });
        return reply.send({
          ok: true,
          bytes: result.bytes,
          receivedBytes: result.receivedBytes,
          complete: result.complete,
        });
      } catch (err) {
        if (err instanceof ChunkTooLargeError) {
          return reply.status(413).send({ error: err.message });
        }
        return reply.status(400).send({
          error: err instanceof Error ? err.message : "Chunk upload failed",
        });
      }
    },
  );

  app.post(
    "/podcasts/:podcastId/episodes/import-project/upload/:uploadId/finish",
    {
      preHandler: [
        requireAuth,
        requireNotReadOnly,
        userRateLimitPreHandler({
          bucket: "import-project",
          windowMs: IMPORT_PROJECT_RATE_LIMIT_WINDOW_MS,
          max: 1,
        }),
      ],
      schema: {
        tags: ["Episodes"],
        summary: "Finish chunked episode project upload and start import",
        params: {
          type: "object",
          properties: {
            podcastId: { type: "string" },
            uploadId: { type: "string" },
          },
          required: ["podcastId", "uploadId"],
        },
        response: {
          202: {
            description: "Import started",
            type: "object",
            properties: { status: { type: "string", enum: ["importing"] } },
            required: ["status"],
          },
          409: { description: "Import already in progress" },
          400: { description: "Invalid upload" },
          403: { description: "Forbidden" },
          404: { description: "Not found" },
          429: { description: "Rate limited" },
        },
      },
    },
    async (request, reply) => {
      const { podcastId, uploadId } = request.params as {
        podcastId: string;
        uploadId: string;
      };
      try {
        assertSafeId(podcastId, "podcastId");
      } catch (err) {
        return reply
          .status(400)
          .send({ error: err instanceof Error ? err.message : "Invalid podcastId" });
      }
      const gate = assertCanImportEpisodeProject(request.userId, podcastId);
      if (!gate.ok) {
        return reply.status(gate.status).send({ error: gate.error });
      }
      const session = getChunkedUpload(uploadId, request.userId!);
      if (!session || session.purpose !== `episode-import:${podcastId}`) {
        return reply.status(404).send({ error: "Upload not found or expired" });
      }
      let tmpZip: string;
      try {
        tmpZip = finalizeChunkedUpload(uploadId, request.userId!);
      } catch (err) {
        return reply.status(400).send({
          error: err instanceof Error ? err.message : "Upload incomplete",
        });
      }
      if (!existsSync(tmpZip) || statSync(tmpZip).size === 0) {
        removeTempPath(tmpZip);
        return reply.status(400).send({ error: "Empty zip file" });
      }
      const started = startProjectImport(
        podcastId,
        tmpZip,
        request.userId!,
        () => afterEpisodeImportRss(podcastId),
      );
      if (!started) {
        removeTempPath(tmpZip);
        return reply.status(409).send({
          status: "importing",
          message: "Project import already in progress",
        });
      }
      return reply.status(202).send({ status: "importing" });
    },
  );

  app.post(
    "/podcasts/:podcastId/episodes/import-project",
    {
      preHandler: [
        requireAuth,
        requireNotReadOnly,
        userRateLimitPreHandler({
          bucket: "import-project",
          windowMs: IMPORT_PROJECT_RATE_LIMIT_WINDOW_MS,
          max: 1,
        }),
      ],
      schema: {
        tags: ["Episodes"],
        summary: "Import episode project zip",
        description:
          "Upload a HarborFM project zip and recreate a draft episode (new ids). Returns 202; poll GET import-project/status until done or failed. Managers and the owner only. Rate limited to once per 30 seconds per user. Prefer chunked upload routes for large zips.",
        params: {
          type: "object",
          properties: { podcastId: { type: "string" } },
          required: ["podcastId"],
        },
        response: {
          202: {
            description: "Import started",
            type: "object",
            properties: { status: { type: "string", enum: ["importing"] } },
            required: ["status"],
          },
          409: {
            description: "Import already in progress",
            type: "object",
            properties: {
              status: { type: "string" },
              message: { type: "string" },
            },
          },
          400: { description: "Invalid zip" },
          403: { description: "Forbidden or at episode limit" },
          404: { description: "Podcast not found" },
          413: { description: "File too large for single-shot upload" },
          429: { description: "Rate limited" },
          500: { description: "Import failed" },
        },
      },
    },
    async (request, reply) => {
      const { podcastId } = request.params as { podcastId: string };
      try {
        assertSafeId(podcastId, "podcastId");
      } catch (err) {
        return reply
          .status(400)
          .send({ error: err instanceof Error ? err.message : "Invalid podcastId" });
      }
      const gate = assertCanImportEpisodeProject(request.userId, podcastId);
      if (!gate.ok) {
        return reply.status(gate.status).send({ error: gate.error });
      }

      const data = await request.file();
      if (!data) {
        return reply.status(400).send({ error: "No file uploaded" });
      }
      const filename = data.filename || "project.zip";
      if (
        !filename.toLowerCase().endsWith(".zip") &&
        data.mimetype !== "application/zip"
      ) {
        return reply
          .status(400)
          .send({ error: "File must be a .zip project export" });
      }

      try {
        const tmpZip = await streamTempZip(data.file, MULTIPART_MAX_BYTES);
        if (!existsSync(tmpZip) || statSync(tmpZip).size === 0) {
          removeTempPath(tmpZip);
          return reply.status(400).send({ error: "Empty zip file" });
        }
        const started = startProjectImport(
          podcastId,
          tmpZip,
          request.userId!,
          () => afterEpisodeImportRss(podcastId),
        );
        if (!started) {
          removeTempPath(tmpZip);
          return reply.status(409).send({
            status: "importing",
            message: "Project import already in progress",
          });
        }
        return reply.status(202).send({ status: "importing" });
      } catch (err) {
        if (err instanceof FileTooLargeError) {
          return reply.status(413).send({
            error:
              "This project zip is too large to upload all at once. Refresh the page and try again.",
          });
        }
        request.log.error({ err }, "import-project failed to start");
        return reply.status(500).send({
          error: err instanceof Error ? err.message : "Failed to import project",
        });
      }
    },
  );
}
