import type { FastifyInstance } from "fastify";
import { db } from "../../db/index.js";
import { requireAuth, requireNotReadOnly } from "../../plugins/auth.js";
import { getPodcastRole, canAccessPodcast } from "../../services/access.js";
import {
  getDeleteStatus,
  setDeleteStatus,
  clearDeleteStatus,
  hasActiveDeleteForUser,
  getActiveDeletePodcastId,
  setActiveDelete,
  runPodcastDelete,
} from "./deleteTask.js";

export async function registerDeleteRoutes(app: FastifyInstance) {
  app.post(
    "/podcasts/:id/delete",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Podcasts"],
        summary: "Delete podcast",
        description:
          "Starts a background deletion. Returns 202. Poll GET /podcasts/:id/delete-status for progress. Only podcast owners and admins can delete. Permanently removes all episodes, files (renders, transcripts, waveforms, RSS, artwork), and the podcast itself.",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        response: {
          202: {
            description: "Delete started",
            type: "object",
            properties: { message: { type: "string" } },
          },
          403: { description: "Permission denied" },
          404: { description: "Podcast not found" },
          409: {
            description: "Already have a delete in progress",
            type: "object",
            properties: {
              error: { type: "string" },
              podcast_id: { type: "string" },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { id: podcastId } = request.params as { id: string };
      const userId = request.userId as string;

      if (!canAccessPodcast(userId, podcastId)) {
        return reply.status(404).send({ error: "Podcast not found" });
      }

      const role = getPodcastRole(userId, podcastId);
      if (role !== "owner") {
        return reply.status(403).send({
          error:
            "Only podcast owners and administrators can delete podcasts.",
        });
      }

      if (hasActiveDeleteForUser(userId)) {
        const existingId = getActiveDeletePodcastId(userId);
        return reply.status(409).send({
          error:
            "You already have a podcast deletion in progress. Wait for it to finish or refresh the page to see its status.",
          podcast_id: existingId,
        });
      }

      const exists = db.prepare("SELECT 1 FROM podcasts WHERE id = ?").get(podcastId);
      if (!exists) {
        return reply.status(404).send({ error: "Podcast not found" });
      }

      setActiveDelete(userId, podcastId);
      setDeleteStatus(podcastId, {
        status: "pending",
        message: "Starting deletion…",
        initiatorUserId: userId,
      });

      setImmediate(() => {
        runPodcastDelete(podcastId, userId).catch((err) => {
          console.error("[Podcast delete] Unexpected error:", err);
        });
      });

      return reply.status(202).send({ message: "Deletion started" });
    },
  );

  app.get(
    "/podcasts/:id/delete-status",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Podcasts"],
        summary: "Get delete status",
        description:
          "Poll after POST /podcasts/:id/delete. Returns status: idle | pending | deleting | done | failed.",
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
                enum: ["idle", "pending", "deleting", "done", "failed"],
              },
              message: { type: "string" },
              error: { type: "string" },
              current_episode: { type: "number" },
              total_episodes: { type: "number" },
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

      const state = getDeleteStatus(podcastId);
      if (!state) {
        return reply.send({
          status: "idle",
          message: undefined,
          error: undefined,
          current_episode: undefined,
          total_episodes: undefined,
        });
      }

      const response = {
        status: state.status,
        message: state.message,
        error: state.error,
        current_episode: state.current,
        total_episodes: state.total,
      };

      if (state.status === "done" || state.status === "failed") {
        clearDeleteStatus(podcastId, state.initiatorUserId);
      }

      return reply.send(response);
    },
  );

  app.get(
    "/podcasts/delete-status",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Podcasts"],
        summary: "Get current user's active delete",
        description:
          "Returns the in-progress delete for the current user, if any. Use on load to restore the delete UI after refresh.",
        response: {
          200: {
            type: "object",
            properties: {
              status: {
                type: "string",
                enum: ["idle", "pending", "deleting", "done", "failed"],
              },
              podcast_id: { type: "string" },
              message: { type: "string" },
              error: { type: "string" },
              current_episode: { type: "number" },
              total_episodes: { type: "number" },
            },
            required: ["status"],
          },
        },
      },
    },
    async (request, reply) => {
      const userId = request.userId as string;
      const podcastId = getActiveDeletePodcastId(userId);
      if (!podcastId) {
        return reply.send({ status: "idle" });
      }
      const state = getDeleteStatus(podcastId);
      if (!state) {
        return reply.send({ status: "idle" });
      }
      return reply.send({
        status: state.status,
        podcast_id: podcastId,
        message: state.message,
        error: state.error,
        current_episode: state.current,
        total_episodes: state.total,
      });
    },
  );
}
