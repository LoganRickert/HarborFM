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
import { assertSafeId } from "../../services/paths.js";
import { writeRssFile, deleteTokenFeedTemplateFile } from "../../services/rss.js";
import { notifyWebSubHub } from "../../services/websub.js";
import * as repo from "./repo.js";
import { getOrBuildProjectZip } from "./projectExport.js";
import {
  ImportValidationError,
  importProjectZip,
  removeTempPath,
  writeTempZip,
} from "./projectImport.js";
import { episodeRowWithFilename } from "./utils.js";

export async function registerProjectRoutes(app: FastifyInstance) {
  app.get(
    "/episodes/:episodeId/project-export",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Episodes"],
        summary: "Download episode project zip",
        description:
          "Download a HarborFM project zip (episode metadata, segments, multitrack recordings, library assets). Editors and above only. Cached under /tmp (best-effort).",
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

  app.post(
    "/podcasts/:podcastId/episodes/import-project",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Episodes"],
        summary: "Import episode project zip",
        description:
          "Upload a HarborFM project zip and recreate a draft episode (new ids). Managers and the owner only.",
        params: {
          type: "object",
          properties: { podcastId: { type: "string" } },
          required: ["podcastId"],
        },
        response: {
          201: { description: "Imported episode id and slug" },
          400: { description: "Invalid zip" },
          403: { description: "Forbidden or at episode limit" },
          404: { description: "Podcast not found" },
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

      let tmpZip: string | null = null;
      try {
        const buffer = await data.toBuffer();
        if (!buffer.length) {
          return reply.status(400).send({ error: "Empty zip file" });
        }
        tmpZip = writeTempZip(buffer);
        const result = await importProjectZip(
          podcastId,
          tmpZip,
          request.userId!,
        );

        try {
          writeRssFile(podcastId, null);
          deleteTokenFeedTemplateFile(podcastId);
          notifyWebSubHub(podcastId, null);
        } catch {
          // non-fatal
        }

        const row = repo.getById(result.episodeId);
        return reply.status(201).send({
          episodeId: result.episodeId,
          slug: result.slug,
          episode: row ? episodeRowWithFilename(row) : undefined,
        });
      } catch (err) {
        if (err instanceof ImportValidationError) {
          return reply.status(400).send({ error: err.message });
        }
        request.log.error({ err }, "import-project failed");
        return reply.status(500).send({
          error: err instanceof Error ? err.message : "Failed to import project",
        });
      } finally {
        if (tmpZip) removeTempPath(tmpZip);
      }
    },
  );
}
