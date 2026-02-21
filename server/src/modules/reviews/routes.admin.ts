import type { FastifyInstance } from "fastify";
import { requireAuth, requireNotReadOnly } from "../../plugins/auth.js";
import { getPodcastRole, canManageCollaborators } from "../../services/access.js";
import {
  listReviewsForPodcast,
  setReviewApproved,
  setReviewHidden,
  getReviewById,
} from "./repo.js";

export async function registerReviewAdminRoutes(app: FastifyInstance) {
  app.get(
    "/podcasts/:id/reviews",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Reviews"],
        summary: "List reviews for a podcast",
        description:
          "List all reviews (podcast and episode) for the podcast. Manager or owner only. Pagination, search, sort.",
        params: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
        querystring: {
          type: "object",
          properties: {
            page: { type: "string" },
            limit: { type: "string" },
            q: { type: "string" },
            sort: { type: "string", enum: ["newest", "oldest"] },
          },
        },
        response: { 200: { description: "Reviews and pagination" }, 403: { description: "Forbidden" }, 404: { description: "Not found" } },
      },
    },
    async (request, reply) => {
      const userId = request.userId as string;
      const podcastId = (request.params as { id: string }).id;
      const role = getPodcastRole(userId, podcastId);
      if (!canManageCollaborators(role)) {
        return reply.status(403).send({ error: "You do not have permission to manage this podcast's reviews." });
      }
      const query = request.query as { page?: string; limit?: string; q?: string; sort?: string };
      const page = Math.max(1, parseInt(query.page ?? "1", 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(query.limit ?? "20", 10) || 20));
      const search = (query.q ?? "").trim();
      const sort = query.sort === "oldest" ? "oldest" : "newest";

      const { rows, total } = listReviewsForPodcast({
        podcastId,
        page,
        limit,
        search,
        sort,
      });

      const reviews = rows.map((r) => ({
        id: r.id,
        podcastId: r.podcastId,
        episodeId: r.episodeId,
        name: r.name,
        email: r.email,
        rating: r.rating,
        body: r.body,
        verified: r.verified,
        approved: r.approved,
        spam: r.spam,
        hidden: r.hidden,
        createdAt: r.createdAt,
        episodeTitle: r.episodeTitle,
      }));

      return reply.send({
        reviews,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    },
  );

  app.patch(
    "/podcasts/:id/reviews/:reviewId/approve",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Reviews"],
        summary: "Approve a review",
        params: {
          type: "object",
          properties: { id: { type: "string" }, reviewId: { type: "string" } },
          required: ["id", "reviewId"],
        },
        response: { 200: { description: "Approved" }, 403: { description: "Forbidden" }, 404: { description: "Not found" } },
      },
    },
    async (request, reply) => {
      const userId = request.userId as string;
      const { id: podcastId, reviewId } = request.params as { id: string; reviewId: string };
      const role = getPodcastRole(userId, podcastId);
      if (!canManageCollaborators(role)) {
        return reply.status(403).send({ error: "You do not have permission to manage this podcast's reviews." });
      }
      const review = getReviewById(reviewId);
      if (!review || review.podcastId !== podcastId) {
        return reply.status(404).send({ error: "Review not found" });
      }
      setReviewApproved(reviewId);
      return reply.send({ ok: true });
    },
  );

  app.delete(
    "/podcasts/:id/reviews/:reviewId",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Reviews"],
        summary: "Delete (hide) a review",
        description: "Manager, owner, or admin only. Hides the review from the public feed and from this list.",
        params: {
          type: "object",
          properties: { id: { type: "string" }, reviewId: { type: "string" } },
          required: ["id", "reviewId"],
        },
        response: { 200: { description: "Deleted" }, 403: { description: "Forbidden" }, 404: { description: "Not found" } },
      },
    },
    async (request, reply) => {
      const userId = request.userId as string;
      const { id: podcastId, reviewId } = request.params as { id: string; reviewId: string };
      const role = getPodcastRole(userId, podcastId);
      if (!canManageCollaborators(role)) {
        return reply.status(403).send({ error: "You do not have permission to manage this podcast's reviews." });
      }
      const review = getReviewById(reviewId);
      if (!review || review.podcastId !== podcastId) {
        return reply.status(404).send({ error: "Review not found" });
      }
      setReviewHidden(reviewId);
      return reply.send({ ok: true });
    },
  );
}
