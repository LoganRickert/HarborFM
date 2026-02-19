import type { FastifyInstance } from "fastify";
import { requireAuth } from "../../plugins/auth.js";
import { getPodcastRole, canEditEpisodeOrPodcastMetadata } from "../../services/access.js";
import * as repo from "./repo.js";

export async function registerRunsRoutes(app: FastifyInstance) {
  app.get(
    "/export-runs/:id",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Exports"],
        summary: "Get export run",
        description: "Get status and log for a deploy run.",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        response: {
          200: { description: "Run record" },
          404: { description: "Run not found" },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const row = repo.getExportRunById(id);
      if (!row) return reply.status(404).send({ error: "Run not found" });
      const role = getPodcastRole(request.userId, row.podcastId);
      if (!canEditEpisodeOrPodcastMetadata(role))
        return reply.status(404).send({ error: "Run not found" });
      return {
        id: row.id,
        exportId: row.exportId,
        podcastId: row.podcastId,
        status: row.status,
        log: row.log ?? null,
        startedAt: row.startedAt,
        finishedAt: row.finishedAt,
      };
    },
  );
}
