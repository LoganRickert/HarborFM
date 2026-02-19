import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { requireAuth, requireNotReadOnly } from "../../plugins/auth.js";
import { getPodcastRole, canEditEpisodeOrPodcastMetadata } from "../../services/access.js";
import { resolveDataPath } from "../../services/paths.js";
import { getDecryptedConfigFromEnc } from "../../services/export-config.js";
import { generateRss, deleteTokenFeedTemplateFile, writeRssFile } from "../../services/rss.js";
import { notifyWebSubHub } from "../../services/websub.js";
import { sqlNow } from "../../db/utils.js";
import { getExport, runDeploy, buildDeployEpisodes } from "./utils.js";
import * as repo from "./repo.js";

export async function registerDeployRoutes(app: FastifyInstance) {
  app.post(
    "/podcasts/:id/exports/deploy",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Exports"],
        summary: "Deploy to all exports",
        description:
          "Deploy podcast feed and published episodes to all configured destinations.",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        response: {
          200: { description: "results per export" },
          400: { description: "No destinations" },
          404: { description: "Podcast not found" },
        },
      },
    },
    async (request, reply) => {
      const { id: podcastId } = request.params as { id: string };
      const role = getPodcastRole(request.userId, podcastId);
      if (!canEditEpisodeOrPodcastMetadata(role)) {
        return reply.status(404).send({ error: "Podcast not found" });
      }
      const rows = repo.listByPodcastId(podcastId);
      if (rows.length === 0) {
        return reply
          .status(400)
          .send({
            error:
              "No delivery destinations configured. Add at least one to deploy.",
          });
      }
      const artworkPathRaw = repo.getPodcastArtworkPath(podcastId);
      const artworkPathResolved =
        artworkPathRaw != null && typeof artworkPathRaw === "string"
          ? resolveDataPath(artworkPathRaw)
          : null;
      const episodesRows = repo.getPublishedEpisodeRowsForDeploy(podcastId);
      const episodes = buildDeployEpisodes(podcastId, episodesRows);

      const results: {
        exportId: string;
        name: string;
        status: string;
        uploaded: number;
        skipped: number;
        errors?: string[];
      }[] = [];
      let lastPublicBaseUrl: string | null = null;
      for (const exp of rows) {
        const exportId = exp.id;
        const name = exp.name ?? "Export";
        const publicBaseUrl = exp.publicBaseUrl ?? null;
        lastPublicBaseUrl = publicBaseUrl;
        const mode = exp.mode || "S3";
        let config: unknown;
        try {
          ({ config } = getDecryptedConfigFromEnc(exp as Record<string, unknown>));
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          results.push({
            exportId,
            name,
            status: "failed",
            uploaded: 0,
            skipped: 0,
            errors: [msg],
          });
          continue;
        }
        const runId = nanoid();
        repo.insertExportRun({
          id: runId,
          exportId,
          podcastId,
          status: "running",
          startedAt: sqlNow(),
        });
        try {
          const xml = generateRss(podcastId, publicBaseUrl);
          const result = await runDeploy(mode, config, {
            publicBaseUrl,
            xml,
            episodes,
            artworkPath: artworkPathResolved,
            podcastId,
          });
          const { uploaded, skipped, errors } = result;
          const status = errors.length > 0 ? "failed" : "success";
          const log =
            errors.length > 0
              ? `Uploaded ${uploaded}, skipped ${skipped}. Errors: ${errors.join("; ")}`
              : `Uploaded ${uploaded} file(s), skipped ${skipped} unchanged.`;
          repo.updateExportRun(runId, { status, finishedAt: sqlNow(), log });
          results.push({
            exportId,
            name,
            status,
            uploaded,
            skipped,
            errors: errors.length > 0 ? errors : undefined,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          repo.updateExportRun(runId, {
            status: "failed",
            finishedAt: sqlNow(),
            log: message,
          });
          results.push({
            exportId,
            name,
            status: "failed",
            uploaded: 0,
            skipped: 0,
            errors: [message],
          });
        }
      }
      if (lastPublicBaseUrl != null) {
        writeRssFile(podcastId, lastPublicBaseUrl);
        deleteTokenFeedTemplateFile(podcastId);
        notifyWebSubHub(podcastId, lastPublicBaseUrl);
      }
      return reply.send({ results });
    },
  );

  app.post(
    "/exports/:exportId/deploy",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Exports"],
        summary: "Deploy single export",
        description: "Deploy podcast feed and episodes to one destination.",
        params: {
          type: "object",
          properties: { exportId: { type: "string" } },
          required: ["exportId"],
        },
        response: {
          200: { description: "run_id, status, uploaded, skipped" },
          400: { description: "Config error" },
          404: { description: "Export not found" },
          500: { description: "Deploy failed" },
        },
      },
    },
    async (request, reply) => {
      const { exportId } = request.params as { exportId: string };
      const exp = getExport(request.userId, exportId);
      if (!exp) return reply.status(404).send({ error: "Export not found" });
      const podcastId = exp.podcastId;
      const publicBaseUrl: string | null = exp.publicBaseUrl ?? null;
      const mode = (exp.mode as string) || "S3";
      let config: unknown;
      try {
        ({ config } = getDecryptedConfigFromEnc(exp));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return reply.status(400).send({ error: msg });
      }
      const runId = nanoid();
      repo.insertExportRun({
        id: runId,
        exportId,
        podcastId,
        status: "running",
        startedAt: sqlNow(),
      });
      try {
        const xml = generateRss(podcastId, publicBaseUrl);
        const artworkPathRaw = repo.getPodcastArtworkPath(podcastId);
        const artworkPathResolved =
          artworkPathRaw != null && typeof artworkPathRaw === "string"
            ? resolveDataPath(artworkPathRaw)
            : null;
        const episodesRows = repo.getPublishedEpisodeRowsForDeploy(podcastId);
        const episodes = buildDeployEpisodes(podcastId, episodesRows);
        const result = await runDeploy(mode, config, {
          publicBaseUrl,
          xml,
          episodes,
          artworkPath: artworkPathResolved,
          podcastId,
        });
        const { uploaded, skipped, errors } = result;
        const log =
          errors.length > 0
            ? `Uploaded ${uploaded}, skipped ${skipped}. Errors: ${errors.join("; ")}`
            : `Uploaded ${uploaded} file(s), skipped ${skipped} unchanged.`;
        repo.updateExportRun(runId, {
          status: errors.length > 0 ? "failed" : "success",
          finishedAt: sqlNow(),
          log,
        });
        writeRssFile(podcastId, publicBaseUrl);
        deleteTokenFeedTemplateFile(podcastId);
        notifyWebSubHub(podcastId, publicBaseUrl);
        return {
          runId,
          status: errors.length > 0 ? "failed" : "success",
          uploaded,
          skipped,
          errors: errors.length > 0 ? errors : undefined,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        repo.updateExportRun(runId, {
          status: "failed",
          finishedAt: sqlNow(),
          log: message,
        });
        return reply
          .status(500)
          .send({ error: "Deploy failed", detail: message });
      }
    },
  );
}
