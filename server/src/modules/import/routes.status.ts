import type { FastifyInstance } from "fastify";
import { requireAuth } from "../../plugins/auth.js";
import { canAccessPodcast, getPodcastOwnerId } from "../../services/access.js";
import {
  importStatusByPodcastId,
  activeImportByUserId,
} from "./utils.js";

export async function registerStatusRoutes(app: FastifyInstance) {
  app.get(
    "/podcasts/import-status",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Podcasts"],
        summary: "Get current user's active import",
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
              podcastId: { type: "string" },
              message: { type: "string" },
              error: { type: "string" },
              currentEpisode: { type: "number" },
              totalEpisodes: { type: "number" },
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
        podcastId,
        message: state.message,
        error: state.error,
        currentEpisode: state.current,
        totalEpisodes: state.total,
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
              currentEpisode: { type: "number" },
              totalEpisodes: { type: "number" },
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
          currentEpisode: undefined,
          totalEpisodes: undefined,
        });
      }
      const response = {
        status: state.status,
        message: state.message,
        error: state.error,
        currentEpisode: state.current,
        totalEpisodes: state.total,
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
