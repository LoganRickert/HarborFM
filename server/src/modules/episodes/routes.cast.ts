import type { FastifyInstance } from "fastify";
import { requireAuth, requireNotReadOnly } from "../../plugins/auth.js";
import { canAccessEpisode, canAssignCastToEpisode } from "../../services/access.js";
import { broadcastToEpisode } from "../../services/episodeBroadcast.js";
import { episodeCastAssignBodySchema } from "@harborfm/shared";
import { castRowToDto } from "./utils.js";
import * as repo from "./repo.js";

export async function registerCastRoutes(app: FastifyInstance) {
  app.get(
    "/podcasts/:podcastId/episodes/:episodeId/cast",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Episodes"],
        summary: "List episode cast",
        params: {
          type: "object",
          properties: {
            podcastId: { type: "string" },
            episodeId: { type: "string" },
          },
          required: ["podcastId", "episodeId"],
        },
        response: {
          200: { description: "Assigned cast" },
          404: { description: "Episode not found" },
        },
      },
    },
    async (request, reply) => {
      const { podcastId, episodeId } = request.params as {
        podcastId: string;
        episodeId: string;
      };
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access || access.podcastId !== podcastId) {
        return reply.status(404).send({ error: "Episode not found" });
      }
      const episode = repo.getById(episodeId);
      if (!episode || episode.podcastId !== podcastId) {
        return reply.status(404).send({ error: "Episode not found" });
      }
      const rows = repo.getEpisodeCast(episodeId);
      return { cast: rows.map(castRowToDto) };
    },
  );

  app.put(
    "/podcasts/:podcastId/episodes/:episodeId/cast",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Episodes"],
        summary: "Assign cast to episode",
        params: {
          type: "object",
          properties: {
            podcastId: { type: "string" },
            episodeId: { type: "string" },
          },
          required: ["podcastId", "episodeId"],
        },
        body: { type: "object", properties: { castIds: { type: "array", items: { type: "string" } } } },
        response: {
          200: { description: "Updated" },
          400: { description: "Invalid castIds" },
          404: { description: "Episode not found" },
        },
      },
    },
    async (request, reply) => {
      const { podcastId, episodeId } = request.params as {
        podcastId: string;
        episodeId: string;
      };
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access || !canAssignCastToEpisode(access.role)) {
        return reply.status(404).send({ error: "Episode not found" });
      }
      const episode = repo.getById(episodeId);
      if (!episode || episode.podcastId !== podcastId) {
        return reply.status(404).send({ error: "Episode not found" });
      }
      const parsed = episodeCastAssignBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: parsed.error.issues[0]?.message ?? "Validation failed",
        });
      }
      const castIds = parsed.data.castIds;
      if (castIds.length > 0 && !repo.validateCastIds(podcastId, castIds)) {
        return reply
          .status(400)
          .send({ error: "One or more cast IDs are invalid or do not belong to this podcast" });
      }
      repo.replaceEpisodeCast(episodeId, castIds);
      const rows = repo.getEpisodeCast(episodeId);
      broadcastToEpisode(episodeId, { type: "castChanged" });
      return { cast: rows.map(castRowToDto) };
    },
  );
}
