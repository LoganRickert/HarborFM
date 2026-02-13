import type { FastifyInstance } from "fastify";
import { podcastCollaboratorAddBodySchema, podcastCollaboratorUpdateBodySchema } from "@harborfm/shared";
import { requireAuth, requireNotReadOnly } from "../../plugins/auth.js";
import { db } from "../../db/index.js";
import { getPodcastRole, canManageCollaborators } from "../../services/access.js";

export async function registerCollaboratorRoutes(app: FastifyInstance) {
  app.get(
    "/podcasts/:podcastId/collaborators",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Podcasts"],
        summary: "List collaborators",
        description:
          "List users with access to the podcast (manager or owner only).",
        params: {
          type: "object",
          properties: { podcastId: { type: "string" } },
          required: ["podcastId"],
        },
        response: {
          200: { description: "List of collaborators" },
          404: { description: "Not found" },
        },
      },
    },
    async (request, reply) => {
      const { podcastId } = request.params as { podcastId: string };
      const role = getPodcastRole(request.userId, podcastId);
      if (!canManageCollaborators(role))
        return reply.status(404).send({ error: "Podcast not found" });
      const rows = db
        .prepare(
          `SELECT ps.user_id, ps.role, ps.created_at, u.email
         FROM podcast_shares ps
         JOIN users u ON u.id = ps.user_id
         WHERE ps.podcast_id = ?
         ORDER BY ps.created_at ASC`,
        )
        .all(podcastId) as Array<{
        user_id: string;
        role: string;
        created_at: string;
        email: string;
      }>;
      return { collaborators: rows };
    },
  );

  app.post(
    "/podcasts/:podcastId/collaborators",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Podcasts"],
        summary: "Add collaborator",
        description:
          "Invite a user by email. Returns USER_NOT_FOUND if email has no account.",
        params: {
          type: "object",
          properties: { podcastId: { type: "string" } },
          required: ["podcastId"],
        },
        body: {
          type: "object",
          properties: { email: { type: "string" }, role: { type: "string" } },
          required: ["email", "role"],
        },
        response: {
          201: { description: "Collaborator added" },
          400: { description: "Invalid role" },
          403: { description: "Collaborator limit" },
          404: { description: "User not found" },
          500: { description: "Server error" },
        },
      },
    },
    async (request, reply) => {
      const { podcastId } = request.params as { podcastId: string };
      const role = getPodcastRole(request.userId, podcastId);
      if (!canManageCollaborators(role))
        return reply.status(404).send({ error: "Podcast not found" });
      const parsed = podcastCollaboratorAddBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: parsed.error.issues[0]?.message ?? "Validation failed", details: parsed.error.flatten() });
      }
      const email = parsed.data.email.trim().toLowerCase();
      const shareRole = parsed.data.role;
      const user = db
        .prepare(
          "SELECT id, COALESCE(disabled, 0) as disabled, COALESCE(read_only, 0) as read_only FROM users WHERE LOWER(email) = ?",
        )
        .get(email) as
        | { id: string; disabled: number; read_only: number }
        | undefined;
      if (!user) {
        return reply.status(404).send({
          error: "user_not_found",
          code: "USER_NOT_FOUND",
          email,
          can_invite_to_platform: true,
        });
      }
      if (user.disabled === 1) {
        return reply
          .status(400)
          .send({
            error:
              "That account is disabled and cannot be added as a collaborator.",
          });
      }
      if (user.read_only === 1) {
        return reply
          .status(400)
          .send({
            error:
              "That account is read-only and cannot be added as a collaborator.",
          });
      }
      const podcast = db
        .prepare(
          "SELECT owner_user_id, max_collaborators FROM podcasts WHERE id = ?",
        )
        .get(podcastId) as
        | { owner_user_id: string; max_collaborators: number | null }
        | undefined;
      if (!podcast)
        return reply.status(404).send({ error: "Podcast not found" });
      const ownerLimits = db
        .prepare("SELECT max_collaborators FROM users WHERE id = ?")
        .get(podcast.owner_user_id) as
        | { max_collaborators: number | null }
        | undefined;
      const maxCollaborators =
        podcast.max_collaborators ?? ownerLimits?.max_collaborators ?? null;
      if (maxCollaborators != null && maxCollaborators > 0) {
        const count = db
          .prepare(
            "SELECT COUNT(*) as count FROM podcast_shares WHERE podcast_id = ?",
          )
          .get(podcastId) as { count: number };
        if (count.count >= maxCollaborators) {
          return reply
            .status(403)
            .send({ error: "This show has reached its collaborator limit." });
        }
      }
      if (user.id === podcast.owner_user_id) {
        return reply
          .status(400)
          .send({ error: "The owner is already on the show." });
      }
      try {
        db.prepare(
          "INSERT INTO podcast_shares (podcast_id, user_id, role) VALUES (?, ?, ?) ON CONFLICT(podcast_id, user_id) DO UPDATE SET role = excluded.role",
        ).run(podcastId, user.id, shareRole);
      } catch {
        return reply.status(500).send({ error: "Failed to add collaborator" });
      }
      const row = db
        .prepare(
          `SELECT ps.user_id, ps.role, ps.created_at, u.email FROM podcast_shares ps JOIN users u ON u.id = ps.user_id WHERE ps.podcast_id = ? AND ps.user_id = ?`,
        )
        .get(podcastId, user.id) as {
        user_id: string;
        role: string;
        created_at: string;
        email: string;
      };
      return reply.status(201).send(row);
    },
  );

  app.patch(
    "/podcasts/:podcastId/collaborators/:userId",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Podcasts"],
        summary: "Update collaborator role",
        params: {
          type: "object",
          properties: {
            podcastId: { type: "string" },
            userId: { type: "string" },
          },
          required: ["podcastId", "userId"],
        },
        body: {
          type: "object",
          properties: { role: { type: "string" } },
          required: ["role"],
        },
        response: {
          200: { description: "Updated" },
          400: { description: "Invalid role" },
          404: { description: "Not found" },
        },
      },
    },
    async (request, reply) => {
      const { podcastId, userId: targetUserId } = request.params as {
        podcastId: string;
        userId: string;
      };
      const role = getPodcastRole(request.userId, podcastId);
      if (!canManageCollaborators(role))
        return reply.status(404).send({ error: "Podcast not found" });
      const parsed = podcastCollaboratorUpdateBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: parsed.error.issues[0]?.message ?? "Validation failed", details: parsed.error.flatten() });
      }
      const shareRole = parsed.data.role;
      const existing = db
        .prepare(
          "SELECT user_id FROM podcast_shares WHERE podcast_id = ? AND user_id = ?",
        )
        .get(podcastId, targetUserId);
      if (!existing)
        return reply.status(404).send({ error: "Collaborator not found" });
      db.prepare(
        "UPDATE podcast_shares SET role = ? WHERE podcast_id = ? AND user_id = ?",
      ).run(shareRole, podcastId, targetUserId);
      const row = db
        .prepare(
          `SELECT ps.user_id, ps.role, ps.created_at, u.email FROM podcast_shares ps JOIN users u ON u.id = ps.user_id WHERE ps.podcast_id = ? AND ps.user_id = ?`,
        )
        .get(podcastId, targetUserId) as {
        user_id: string;
        role: string;
        created_at: string;
        email: string;
      };
      return row;
    },
  );

  app.delete(
    "/podcasts/:podcastId/collaborators/:userId",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Podcasts"],
        summary: "Remove collaborator",
        description:
          "Remove access. Caller can be manager/owner or the user themselves (leave).",
        params: {
          type: "object",
          properties: {
            podcastId: { type: "string" },
            userId: { type: "string" },
          },
          required: ["podcastId", "userId"],
        },
        response: {
          204: { description: "Removed" },
          404: { description: "Not found" },
        },
      },
    },
    async (request, reply) => {
      const { podcastId, userId: targetUserId } = request.params as {
        podcastId: string;
        userId: string;
      };
      const role = getPodcastRole(request.userId, podcastId);
      const isSelf = request.userId === targetUserId;
      if (!canManageCollaborators(role) && !isSelf)
        return reply.status(404).send({ error: "Podcast not found" });
      const existing = db
        .prepare(
          "SELECT user_id FROM podcast_shares WHERE podcast_id = ? AND user_id = ?",
        )
        .get(podcastId, targetUserId);
      if (!existing)
        return reply.status(404).send({ error: "Collaborator not found" });
      db.prepare(
        "DELETE FROM podcast_shares WHERE podcast_id = ? AND user_id = ?",
      ).run(podcastId, targetUserId);
      return reply.status(204).send();
    },
  );
}
