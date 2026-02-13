import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { randomBytes } from "crypto";
import { requireAuth, requireNotReadOnly } from "../../plugins/auth.js";
import { db } from "../../db/index.js";
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
      let whereClause = "podcast_id = ?";
      const params: (string | number)[] = [podcastId];
      if (q && q.trim()) {
        whereClause += " AND name LIKE ?";
        params.push(`%${q.trim()}%`);
      }
      const countResult = db
        .prepare(
          `SELECT COUNT(*) as count FROM subscriber_tokens WHERE ${whereClause}`,
        )
        .get(...params) as { count: number };
      const total = countResult.count;
      const orderBy = sort === "oldest" ? "created_at ASC" : "created_at DESC";
      const rows = db
        .prepare(
          `SELECT id, name, created_at, valid_from, valid_until, COALESCE(disabled, 0) AS disabled, last_used_at 
         FROM subscriber_tokens 
         WHERE ${whereClause} 
         ORDER BY ${orderBy} 
         LIMIT ? OFFSET ?`,
        )
        .all(...params, limit, offset) as Array<{
        id: string;
        name: string;
        created_at: string;
        valid_from: string | null;
        valid_until: string | null;
        disabled: number;
        last_used_at: string | null;
      }>;
      return { tokens: rows, total };
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
            valid_from: { type: "string" },
            valid_until: { type: "string" },
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
      const podcast = db
        .prepare(
          "SELECT owner_user_id, COALESCE(subscriber_only_feed_enabled, 0) AS subscriber_only_feed_enabled, max_subscriber_tokens FROM podcasts WHERE id = ?",
        )
        .get(podcastId) as
        | {
            owner_user_id: string;
            subscriber_only_feed_enabled: number;
            max_subscriber_tokens: number | null;
          }
        | undefined;
      if (!podcast)
        return reply.status(404).send({ error: "Podcast not found" });
      if (podcast.subscriber_only_feed_enabled !== 1) {
        return reply
          .status(400)
          .send({
            error:
              'Enable "Subscriber only feed" in show settings before creating tokens.',
          });
      }
      const settings = readSettings();
      const ownerLimits = db
        .prepare("SELECT max_subscriber_tokens FROM users WHERE id = ?")
        .get(podcast.owner_user_id) as
        | { max_subscriber_tokens: number | null }
        | undefined;
      const effectiveMax =
        podcast.max_subscriber_tokens ??
        ownerLimits?.max_subscriber_tokens ??
        settings.default_max_subscriber_tokens ??
        null;
      if (effectiveMax != null && effectiveMax > 0) {
        const count = db
          .prepare(
            "SELECT COUNT(*) as count FROM subscriber_tokens WHERE podcast_id = ?",
          )
          .get(podcastId) as { count: number };
        if (count.count >= effectiveMax) {
          return reply.status(400).send({
            error: `This show has reached its limit of ${effectiveMax} subscriber token${effectiveMax === 1 ? "" : "s"}. Delete one to create a new one.`,
          });
        }
      }
      const body = request.body as {
        name?: string;
        valid_from?: string;
        valid_until?: string;
      };
      const name = typeof body?.name === "string" ? body.name.trim() : "";
      if (!name) return reply.status(400).send({ error: "name is required" });
      const validFrom =
        typeof body?.valid_from === "string" && body.valid_from.trim()
          ? body.valid_from.trim()
          : null;
      const validUntil =
        typeof body?.valid_until === "string" && body.valid_until.trim()
          ? body.valid_until.trim()
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
      db.prepare(
        "INSERT INTO subscriber_tokens (id, podcast_id, name, token_hash, valid_from, valid_until) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(id, podcastId, name, tokenHash, validFrom, validUntil);
      const row = db
        .prepare(
          "SELECT id, name, created_at, valid_from, valid_until FROM subscriber_tokens WHERE id = ?",
        )
        .get(id) as {
        id: string;
        name: string;
        created_at: string;
        valid_from: string | null;
        valid_until: string | null;
      };
      return reply.status(201).send({ ...row, token: rawToken });
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
            valid_until: { type: "string" },
            valid_from: { type: "string" },
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
      const existing = db
        .prepare(
          "SELECT id FROM subscriber_tokens WHERE id = ? AND podcast_id = ?",
        )
        .get(tokenId, podcastId);
      if (!existing)
        return reply.status(404).send({ error: "Token not found" });
      const body = subscriberTokenUpdateSchema.parse(request.body);
      const updates: string[] = [];
      const values: (string | number | boolean | null)[] = [];
      if (body.disabled !== undefined) {
        updates.push("disabled = ?");
        values.push(body.disabled ? 1 : 0);
      }
      if (body.valid_until !== undefined) {
        const validUntil =
          typeof body.valid_until === "string" && body.valid_until.trim()
            ? body.valid_until.trim()
            : null;
        if (validUntil) {
          const now = new Date().toISOString();
          if (validUntil < now) {
            return reply
              .status(400)
              .send({ error: "Expiration date cannot be in the past" });
          }
        }
        updates.push("valid_until = ?");
        values.push(validUntil);
      }
      if (body.valid_from !== undefined) {
        updates.push("valid_from = ?");
        values.push(
          typeof body.valid_from === "string" && body.valid_from.trim()
            ? body.valid_from.trim()
            : null,
        );
      }
      if (updates.length === 0)
        return reply.status(400).send({ error: "No fields to update" });
      values.push(tokenId);
      db.prepare(
        `UPDATE subscriber_tokens SET ${updates.join(", ")} WHERE id = ?`,
      ).run(...values);
      const row = db
        .prepare(
          "SELECT id, name, created_at, valid_from, valid_until, COALESCE(disabled, 0) AS disabled, last_used_at FROM subscriber_tokens WHERE id = ?",
        )
        .get(tokenId) as {
        id: string;
        name: string;
        created_at: string;
        valid_from: string | null;
        valid_until: string | null;
        disabled: number;
        last_used_at: string | null;
      };
      return row;
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
      const existing = db
        .prepare(
          "SELECT id FROM subscriber_tokens WHERE id = ? AND podcast_id = ?",
        )
        .get(tokenId, podcastId);
      if (!existing)
        return reply.status(404).send({ error: "Token not found" });
      db.prepare("DELETE FROM subscriber_tokens WHERE id = ?").run(tokenId);
      return reply.status(204).send();
    },
  );
}
