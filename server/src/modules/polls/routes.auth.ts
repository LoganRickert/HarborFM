import type { FastifyInstance } from "fastify";
import { episodePollPutBodySchema } from "@harborfm/shared";
import { requireAuth, requireNotReadOnly } from "../../plugins/auth.js";
import { canAccessEpisode, canEditEpisodeOrPodcastMetadata, getPodcastRole } from "../../services/access.js";
import { assertSafeId } from "../../services/paths.js";
import * as episodeRepo from "../episodes/repo.js";
import {
  emptyPollDto,
  getPollByEpisodeId,
  rowToDto,
  upsertPoll,
  aggregateCreatorResults,
} from "./repo.js";

export async function registerPollAuthRoutes(app: FastifyInstance) {
  app.get(
    "/episodes/:id/poll",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Polls"],
        summary: "Get episode poll",
        description: "Returns the poll for an episode (empty defaults if none). Requires episode access.",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        response: {
          200: { description: "Poll" },
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
      if (!canAccessEpisode(request.userId, episodeId)) {
        return reply.status(404).send({ error: "Episode not found" });
      }
      const row = getPollByEpisodeId(episodeId);
      if (!row) return reply.send(emptyPollDto(episodeId));
      return reply.send(rowToDto(row));
    },
  );

  app.put(
    "/episodes/:id/poll",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Polls"],
        summary: "Create or update episode poll",
        description: "Upserts poll settings and questions. Requires edit access.",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        response: {
          200: { description: "Poll saved" },
          400: { description: "Invalid body" },
          403: { description: "Forbidden" },
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
      const episode = episodeRepo.getById(episodeId);
      if (!episode) return reply.status(404).send({ error: "Episode not found" });
      const role = getPodcastRole(request.userId, episode.podcastId);
      if (!canEditEpisodeOrPodcastMetadata(role)) {
        return reply.status(403).send({ error: "Forbidden" });
      }
      const parsed = episodePollPutBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: parsed.error.issues[0]?.message ?? "Invalid body",
        });
      }
      if (parsed.data.startAt && parsed.data.endAt && parsed.data.startAt > parsed.data.endAt) {
        return reply.status(400).send({ error: "startAt must be before endAt" });
      }
      const existing = getPollByEpisodeId(episodeId);
      const row = upsertPoll(episodeId, parsed.data, existing?.id);
      return reply.send(rowToDto(row));
    },
  );

  app.get(
    "/episodes/:id/poll/results",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Polls"],
        summary: "Get episode poll results (creator)",
        description:
          "Full results with counts, emails, and short answers. Query verified=all|verified|unverified.",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        querystring: {
          type: "object",
          properties: {
            verified: { type: "string", enum: ["all", "verified", "unverified"] },
          },
        },
        response: {
          200: { description: "Results" },
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
      if (!canAccessEpisode(request.userId, episodeId)) {
        return reply.status(404).send({ error: "Episode not found" });
      }
      const row = getPollByEpisodeId(episodeId);
      if (!row) {
        return reply.send({
          questions: [],
          emails: [],
          totalSubmissions: 0,
        });
      }
      const q = request.query as { verified?: string };
      const verifiedFilter =
        q.verified === "verified" || q.verified === "unverified" ? q.verified : "all";
      return reply.send(aggregateCreatorResults(row, verifiedFilter));
    },
  );
}
