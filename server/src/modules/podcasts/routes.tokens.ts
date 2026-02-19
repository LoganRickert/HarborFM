import type { FastifyInstance } from "fastify";
import { and, asc, desc, eq, like, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { randomBytes } from "crypto";
import { requireAuth, requireNotReadOnly } from "../../plugins/auth.js";
import { drizzleDb } from "../../db/index.js";
import { podcasts, subscriberTokens, users } from "../../db/schema.js";
import { getPodcastRole, canManageCollaborators } from "../../services/access.js";
import { SUBSCRIBER_TOKEN_PREFIX } from "../../config.js";
import { sha256Hex } from "../../utils/hash.js";
import { subscriberTokenUpdateSchema } from "@harborfm/shared";
import { readSettings } from "../settings/index.js";

export async function registerTokenRoutes(app: FastifyInstance) {
  app.get(
    "/podcasts/:podcastId/subscriber-tokens",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Podcasts"],
        summary: "List subscriber tokens",
        description:
          "List subscriber tokens for the podcast. Manager or owner only. Supports pagination, search, and sort.",
        params: {
          type: "object",
          properties: { podcastId: { type: "string" } },
          required: ["podcastId"],
        },
        querystring: {
          type: "object",
          properties: {
            limit: { type: "number", minimum: 1, maximum: 100, default: 10 },
            offset: { type: "number", minimum: 0, default: 0 },
            q: { type: "string" },
            sort: {
              type: "string",
              enum: ["newest", "oldest"],
              default: "newest",
            },
          },
        },
        response: {
          200: { description: "List of tokens with pagination" },
          404: { description: "Not found" },
        },
      },
    },
    async (request, reply) => {
      const { podcastId } = request.params as { podcastId: string };
      const {
        limit = 10,
        offset = 0,
        q,
        sort = "newest",
      } = request.query as {
        limit?: number;
        offset?: number;
        q?: string;
        sort?: "newest" | "oldest";
      };
      const role = getPodcastRole(request.userId, podcastId);
      if (!canManageCollaborators(role))
        return reply.status(404).send({ error: "Podcast not found" });
      const conditions = [eq(subscriberTokens.podcastId, podcastId)];
      if (q?.trim()) {
        conditions.push(like(subscriberTokens.name, `%${q.trim()}%`));
      }
      const whereClause = and(...conditions);

      const countResult = drizzleDb
        .select({ count: sql<number>`COUNT(*)`.as("count") })
        .from(subscriberTokens)
        .where(whereClause)
        .get();
      const total = countResult?.count ?? 0;

      const orderBy =
        sort === "oldest"
          ? asc(subscriberTokens.createdAt)
          : desc(subscriberTokens.createdAt);
      const rows = drizzleDb
        .select({
          id: subscriberTokens.id,
          name: subscriberTokens.name,
          createdAt: subscriberTokens.createdAt,
          validFrom: subscriberTokens.validFrom,
          validUntil: subscriberTokens.validUntil,
          disabled: sql<number>`COALESCE(${subscriberTokens.disabled}, 0)`.as("disabled"),
          lastUsedAt: subscriberTokens.lastUsedAt,
        })
        .from(subscriberTokens)
        .where(whereClause)
        .orderBy(orderBy)
        .limit(limit)
        .offset(offset)
        .all();
      return {
        tokens: rows.map((r) => ({
          id: r.id,
          name: r.name,
          createdAt: r.createdAt,
          validFrom: r.validFrom,
          validUntil: r.validUntil,
          disabled: r.disabled,
          lastUsedAt: r.lastUsedAt,
        })),
        total,
      };
    },
  );

  app.post(
    "/podcasts/:podcastId/subscriber-tokens",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Podcasts"],
        summary: "Create subscriber token",
        description:
          "Create a new subscriber token. Raw token returned only once. Manager or owner only. Requires subscriber-only feed enabled on the podcast.",
        params: {
          type: "object",
          properties: { podcastId: { type: "string" } },
          required: ["podcastId"],
        },
        body: {
          type: "object",
          properties: {
            name: { type: "string" },
            validFrom: { type: "string" },
            validUntil: { type: "string" },
          },
          required: ["name"],
        },
        response: {
          201: { description: "Token created" },
          400: { description: "At limit or validation" },
          404: { description: "Not found" },
        },
      },
    },
    async (request, reply) => {
      const { podcastId } = request.params as { podcastId: string };
      const role = getPodcastRole(request.userId, podcastId);
      if (!canManageCollaborators(role))
        return reply.status(404).send({ error: "Podcast not found" });
      const podcast = drizzleDb
        .select({
          ownerUserId: podcasts.ownerUserId,
          subscriberOnlyFeedEnabled: sql<number>`COALESCE(${podcasts.subscriberOnlyFeedEnabled}, 0)`.as(
            "subscriberOnlyFeedEnabled",
          ),
          maxSubscriberTokens: podcasts.maxSubscriberTokens,
        })
        .from(podcasts)
        .where(eq(podcasts.id, podcastId))
        .limit(1)
        .get();
      if (!podcast)
        return reply.status(404).send({ error: "Podcast not found" });
      if (!podcast.subscriberOnlyFeedEnabled) {
        return reply
          .status(400)
          .send({
            error:
              'Enable "Subscriber only feed" in show settings before creating tokens.',
          });
      }
      const settings = readSettings();
      const ownerLimits = drizzleDb
        .select({ maxSubscriberTokens: users.maxSubscriberTokens })
        .from(users)
        .where(eq(users.id, podcast.ownerUserId))
        .limit(1)
        .get();
      const effectiveMax =
        podcast.maxSubscriberTokens ??
        ownerLimits?.maxSubscriberTokens ??
        settings.default_max_subscriber_tokens ??
        null;
      if (effectiveMax != null && effectiveMax > 0) {
        const countRow = drizzleDb
          .select({ count: sql<number>`COUNT(*)`.as("count") })
          .from(subscriberTokens)
          .where(eq(subscriberTokens.podcastId, podcastId))
          .get();
        const count = countRow?.count ?? 0;
        if (count >= effectiveMax) {
          return reply.status(400).send({
            error: `This show has reached its limit of ${effectiveMax} subscriber token${effectiveMax === 1 ? "" : "s"}. Delete one to create a new one.`,
          });
        }
      }
      const body = request.body as {
        name?: string;
        validFrom?: string;
        validUntil?: string;
      };
      const name = typeof body?.name === "string" ? body.name.trim() : "";
      if (!name) return reply.status(400).send({ error: "name is required" });
      const validFrom =
        typeof body?.validFrom === "string" && body.validFrom.trim()
          ? body.validFrom.trim()
          : null;
      const validUntil =
        typeof body?.validUntil === "string" && body.validUntil.trim()
          ? body.validUntil.trim()
          : null;
      if (validUntil) {
        const now = new Date().toISOString();
        if (validUntil < now) {
          return reply
            .status(400)
            .send({ error: "Expiration date cannot be in the past" });
        }
      }
      const id = nanoid();
      const rawToken =
        SUBSCRIBER_TOKEN_PREFIX + randomBytes(32).toString("hex");
      const tokenHash = sha256Hex(rawToken);
      drizzleDb
        .insert(subscriberTokens)
        .values({
          id,
          podcastId,
          name,
          tokenHash,
          validFrom,
          validUntil,
        })
        .run();
      const row = drizzleDb
        .select({
          id: subscriberTokens.id,
          name: subscriberTokens.name,
          createdAt: subscriberTokens.createdAt,
          validFrom: subscriberTokens.validFrom,
          validUntil: subscriberTokens.validUntil,
        })
        .from(subscriberTokens)
        .where(eq(subscriberTokens.id, id))
        .limit(1)
        .get();
      if (!row)
        return reply.status(404).send({ error: "Token not found" });
      return reply.status(201).send({
        id: row.id,
        name: row.name,
        createdAt: row.createdAt,
        validFrom: row.validFrom,
        validUntil: row.validUntil,
        token: rawToken,
      });
    },
  );

  app.patch(
    "/podcasts/:podcastId/subscriber-tokens/:id",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Podcasts"],
        summary: "Update subscriber token",
        description:
          "Disable or extend (valid_until) a subscriber token. Manager or owner only.",
        params: {
          type: "object",
          properties: { podcastId: { type: "string" }, id: { type: "string" } },
          required: ["podcastId", "id"],
        },
        body: {
          type: "object",
          properties: {
            disabled: { type: "boolean" },
            validUntil: { type: "string" },
            validFrom: { type: "string" },
          },
        },
        response: {
          200: { description: "Updated" },
          400: { description: "No fields to update" },
          404: { description: "Not found" },
        },
      },
    },
    async (request, reply) => {
      const { podcastId, id: tokenId } = request.params as {
        podcastId: string;
        id: string;
      };
      const role = getPodcastRole(request.userId, podcastId);
      if (!canManageCollaborators(role))
        return reply.status(404).send({ error: "Podcast not found" });
      const existing = drizzleDb
        .select({ id: subscriberTokens.id })
        .from(subscriberTokens)
        .where(
          and(
            eq(subscriberTokens.id, tokenId),
            eq(subscriberTokens.podcastId, podcastId),
          ),
        )
        .limit(1)
        .get();
      if (!existing)
        return reply.status(404).send({ error: "Token not found" });
      const body = subscriberTokenUpdateSchema.parse(request.body);
      const set: Partial<{
        disabled: boolean;
        validUntil: string | null;
        validFrom: string | null;
      }> = {};
      if (body.disabled !== undefined) {
        set.disabled = body.disabled;
      }
      if (body.validUntil !== undefined) {
        const validUntil =
          typeof body.validUntil === "string" && body.validUntil.trim()
            ? body.validUntil.trim()
            : null;
        if (validUntil) {
          const now = new Date().toISOString();
          if (validUntil < now) {
            return reply
              .status(400)
              .send({ error: "Expiration date cannot be in the past" });
          }
        }
        set.validUntil = validUntil;
      }
      if (body.validFrom !== undefined) {
        set.validFrom =
          typeof body.validFrom === "string" && body.validFrom.trim()
            ? body.validFrom.trim()
            : null;
      }
      if (Object.keys(set).length === 0)
        return reply.status(400).send({ error: "No fields to update" });
      drizzleDb
        .update(subscriberTokens)
        .set(set)
        .where(
          and(
            eq(subscriberTokens.id, tokenId),
            eq(subscriberTokens.podcastId, podcastId),
          ),
        )
        .run();
      const row = drizzleDb
        .select({
          id: subscriberTokens.id,
          name: subscriberTokens.name,
          createdAt: subscriberTokens.createdAt,
          validFrom: subscriberTokens.validFrom,
          validUntil: subscriberTokens.validUntil,
          disabled: sql<number>`COALESCE(${subscriberTokens.disabled}, 0)`.as("disabled"),
          lastUsedAt: subscriberTokens.lastUsedAt,
        })
        .from(subscriberTokens)
        .where(eq(subscriberTokens.id, tokenId))
        .limit(1)
        .get();
      if (!row)
        return reply.status(404).send({ error: "Token not found" });
      return {
        id: row.id,
        name: row.name,
        createdAt: row.createdAt,
        validFrom: row.validFrom,
        validUntil: row.validUntil,
        disabled: row.disabled,
        lastUsedAt: row.lastUsedAt,
      };
    },
  );

  app.delete(
    "/podcasts/:podcastId/subscriber-tokens/:id",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Podcasts"],
        summary: "Delete subscriber token",
        description:
          "Permanently remove a subscriber token. Manager or owner only.",
        params: {
          type: "object",
          properties: { podcastId: { type: "string" }, id: { type: "string" } },
          required: ["podcastId", "id"],
        },
        response: {
          204: { description: "Deleted" },
          404: { description: "Not found" },
        },
      },
    },
    async (request, reply) => {
      const { podcastId, id: tokenId } = request.params as {
        podcastId: string;
        id: string;
      };
      const role = getPodcastRole(request.userId, podcastId);
      if (!canManageCollaborators(role))
        return reply.status(404).send({ error: "Podcast not found" });
      const existing = drizzleDb
        .select({ id: subscriberTokens.id })
        .from(subscriberTokens)
        .where(
          and(
            eq(subscriberTokens.id, tokenId),
            eq(subscriberTokens.podcastId, podcastId),
          ),
        )
        .limit(1)
        .get();
      if (!existing)
        return reply.status(404).send({ error: "Token not found" });
      drizzleDb
        .delete(subscriberTokens)
        .where(
          and(
            eq(subscriberTokens.id, tokenId),
            eq(subscriberTokens.podcastId, podcastId),
          ),
        )
        .run();
      return reply.status(204).send();
    },
  );
}
