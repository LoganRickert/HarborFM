import type { FastifyInstance } from "fastify";
import { createReadStream, existsSync, statSync } from "fs";
import { requireAuth, requireNotReadOnly } from "../../plugins/auth.js";
import {
  canAccessEpisode,
  canAccessPodcast,
  canEditEpisodeOrPodcastMetadata,
  canEditSegments,
  getPodcastRole,
} from "../../services/access.js";
import { IMPORT_PROJECT_RATE_LIMIT_WINDOW_MS } from "../../config.js";
import { assertSafeId } from "../../services/paths.js";
import { userRateLimitPreHandler } from "../../services/rateLimit.js";
import { writeRssFile, deleteTokenFeedTemplateFile } from "../../services/rss.js";
import { notifyWebSubHub } from "../../services/websub.js";
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
  writeTempZip,
} from "./projectImport.js";

export async function registerProjectRoutes(app: FastifyInstance) {
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
          "Upload a HarborFM project zip and recreate a draft episode (new ids). Returns 202; poll GET import-project/status until done or failed. Managers and the owner only. Rate limited to once per 30 seconds per user.",
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
      if (!canAccessPodcast(request.userId, podcastId)) {
        return reply.status(404).send({ error: "Podcast not found" });
      }
      const role = getPodcastRole(request.userId, podcastId);
      if (!canEditEpisodeOrPodcastMetadata(role)) {
        return reply.status(403).send({
          error: "Only managers and the owner can import project zips",
        });
      }

      const { maxEpisodes } = repo.getCreateLimit(podcastId);
      if (maxEpisodes != null && maxEpisodes > 0) {
        const count = repo.countByPodcastId(podcastId);
        if (count >= maxEpisodes) {
          return reply.status(403).send({
            error: `This show has reached its limit of ${maxEpisodes} episode${maxEpisodes === 1 ? "" : "s"}. You cannot import more.`,
          });
        }
      }

      const data = await request.file();
      if (!data) {
        return reply.status(400).send({ error: "No file uploaded" });
      }
      const filename = data.filename || "project.zip";
      if (!filename.toLowerCase().endsWith(".zip") && data.mimetype !== "application/zip") {
        return reply.status(400).send({ error: "File must be a .zip project export" });
      }

      try {
        const buffer = await data.toBuffer();
        if (!buffer.length) {
          return reply.status(400).send({ error: "Empty zip file" });
        }
        const tmpZip = writeTempZip(buffer);
        const started = startProjectImport(
          podcastId,
          tmpZip,
          request.userId!,
          () => {
            try {
              writeRssFile(podcastId, null);
              deleteTokenFeedTemplateFile(podcastId);
              notifyWebSubHub(podcastId, null);
            } catch {
              // non-fatal
            }
          },
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
        request.log.error({ err }, "import-project failed to start");
        return reply.status(500).send({
          error: err instanceof Error ? err.message : "Failed to import project",
        });
      }
    },
  );
}
