import type { FastifyInstance } from "fastify";
import { and, asc, eq, sql } from "drizzle-orm";
import { podcastCollaboratorAddBodySchema, podcastCollaboratorUpdateBodySchema } from "@harborfm/shared";
import { requireAuth, requireNotReadOnly } from "../../plugins/auth.js";
import { drizzleDb } from "../../db/index.js";
import { podcastShares, podcasts, users } from "../../db/schema.js";
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
      const rows = drizzleDb
        .select({
          userId: podcastShares.userId,
          role: podcastShares.role,
          createdAt: podcastShares.createdAt,
          username: users.username,
        })
        .from(podcastShares)
        .innerJoin(users, eq(users.id, podcastShares.userId))
        .where(eq(podcastShares.podcastId, podcastId))
        .orderBy(asc(podcastShares.createdAt))
        .all();
      const collaborators = rows.map((r) => ({
        userId: r.userId,
        role: r.role,
        createdAt: r.createdAt,
        username: r.username ?? "",
      }));
      return { collaborators };
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
          "Invite a user by email or username. If input contains @, lookup by email; otherwise by username. Returns USER_NOT_FOUND if no account.",
        params: {
          type: "object",
          properties: { podcastId: { type: "string" } },
          required: ["podcastId"],
        },
        body: {
          type: "object",
          properties: {
            email: { type: "string", description: "Email or username (handle). If contains @, lookup by email; else by username." },
            role: { type: "string" },
          },
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
      const input = parsed.data.email.trim();
      const shareRole = parsed.data.role;
      const isEmail = input.includes("@");
      const lowerInput = input.toLowerCase();
      const user = drizzleDb
        .select({
          id: users.id,
          disabled: sql<number>`COALESCE(${users.disabled}, 0)`.as("disabled"),
          readOnly: sql<number>`COALESCE(${users.readOnly}, 0)`.as("readOnly"),
        })
        .from(users)
        .where(
          isEmail
            ? sql`LOWER(${users.email}) = ${lowerInput}`
            : sql`LOWER(${users.username}) = ${lowerInput}`,
        )
        .limit(1)
        .get();
      if (!user) {
        return reply.status(404).send({
          error: "user_not_found",
          code: "USER_NOT_FOUND",
          email: isEmail ? input : undefined,
          can_invite_to_platform: isEmail,
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
      if (user.readOnly === 1) {
        return reply
          .status(400)
          .send({
            error:
              "That account is read-only and cannot be added as a collaborator.",
          });
      }
      const podcast = drizzleDb
        .select({
          ownerUserId: podcasts.ownerUserId,
          maxCollaborators: podcasts.maxCollaborators,
        })
        .from(podcasts)
        .where(eq(podcasts.id, podcastId))
        .limit(1)
        .get();
      if (!podcast)
        return reply.status(404).send({ error: "Podcast not found" });
      const ownerLimits = drizzleDb
        .select({ maxCollaborators: users.maxCollaborators })
        .from(users)
        .where(eq(users.id, podcast.ownerUserId))
        .limit(1)
        .get();
      const maxCollaborators =
        podcast.maxCollaborators ?? ownerLimits?.maxCollaborators ?? null;
      if (maxCollaborators != null && maxCollaborators > 0) {
        const countRow = drizzleDb
          .select({ count: sql<number>`COUNT(*)`.as("count") })
          .from(podcastShares)
          .where(eq(podcastShares.podcastId, podcastId))
          .get();
        const count = countRow?.count ?? 0;
        if (count >= maxCollaborators) {
          return reply
            .status(403)
            .send({ error: "This show has reached its collaborator limit." });
        }
      }
      if (user.id === podcast.ownerUserId) {
        return reply
          .status(400)
          .send({ error: "The owner is already on the show." });
      }
      try {
        drizzleDb
          .insert(podcastShares)
          .values({
            podcastId,
            userId: user.id,
            role: shareRole,
          })
          .onConflictDoUpdate({
            target: [podcastShares.podcastId, podcastShares.userId],
            set: { role: shareRole },
          })
          .run();
      } catch {
        return reply.status(500).send({ error: "Failed to add collaborator" });
      }
      const row = drizzleDb
        .select({
          userId: podcastShares.userId,
          role: podcastShares.role,
          createdAt: podcastShares.createdAt,
          username: users.username,
        })
        .from(podcastShares)
        .innerJoin(users, eq(users.id, podcastShares.userId))
        .where(
          and(
            eq(podcastShares.podcastId, podcastId),
            eq(podcastShares.userId, user.id),
          ),
        )
        .limit(1)
        .get();
      if (!row)
        return reply.status(500).send({ error: "Failed to fetch collaborator" });
      return reply.status(201).send({
        userId: row.userId,
        role: row.role,
        createdAt: row.createdAt,
        username: row.username ?? "",
      });
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
      const existing = drizzleDb
        .select({ userId: podcastShares.userId })
        .from(podcastShares)
        .where(
          and(
            eq(podcastShares.podcastId, podcastId),
            eq(podcastShares.userId, targetUserId),
          ),
        )
        .limit(1)
        .get();
      if (!existing)
        return reply.status(404).send({ error: "Collaborator not found" });
      drizzleDb
        .update(podcastShares)
        .set({ role: shareRole })
        .where(
          and(
            eq(podcastShares.podcastId, podcastId),
            eq(podcastShares.userId, targetUserId),
          ),
        )
        .run();
      const row = drizzleDb
        .select({
          userId: podcastShares.userId,
          role: podcastShares.role,
          createdAt: podcastShares.createdAt,
          username: users.username,
        })
        .from(podcastShares)
        .innerJoin(users, eq(users.id, podcastShares.userId))
        .where(
          and(
            eq(podcastShares.podcastId, podcastId),
            eq(podcastShares.userId, targetUserId),
          ),
        )
        .limit(1)
        .get();
      if (!row)
        return reply.status(404).send({ error: "Collaborator not found" });
      return {
        userId: row.userId,
        role: row.role,
        createdAt: row.createdAt,
        username: row.username ?? "",
      };
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
      const existing = drizzleDb
        .select({ userId: podcastShares.userId })
        .from(podcastShares)
        .where(
          and(
            eq(podcastShares.podcastId, podcastId),
            eq(podcastShares.userId, targetUserId),
          ),
        )
        .limit(1)
        .get();
      if (!existing)
        return reply.status(404).send({ error: "Collaborator not found" });
      drizzleDb
        .delete(podcastShares)
        .where(
          and(
            eq(podcastShares.podcastId, podcastId),
            eq(podcastShares.userId, targetUserId),
          ),
        )
        .run();
      return reply.status(204).send();
    },
  );
}
