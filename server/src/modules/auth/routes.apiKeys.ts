import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { randomBytes } from "crypto";
import { requireAuth, requireNotReadOnly } from "../../plugins/auth.js";
import { db } from "../../db/index.js";
import {
  authApiKeyCreateBodySchema,
  authApiKeyUpdateBodySchema,
  authApiKeyIdParamSchema,
  authApiKeyListQuerySchema,
} from "@harborfm/shared";
import { sha256Hex } from "../../utils/hash.js";
import { API_KEY_PREFIX, MAX_API_KEYS_PER_USER } from "../../config.js";
import { requireSession } from "./shared.js";

export async function registerApiKeysRoutes(app: FastifyInstance) {
  app.get(
    "/auth/api-keys",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Auth"],
        summary: "List API keys",
        description:
          "List your API keys with optional pagination, search by name, and sort. Requires session (not API key).",
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
          200: { description: "List of API keys with total" },
          401: { description: "Unauthorized" },
          403: { description: "Use session to manage keys" },
        },
      },
    },
    async (request, reply) => {
      if (
        !requireSession(request, reply as Parameters<typeof requireSession>[1])
      )
        return;
      const queryParsed = authApiKeyListQuerySchema.safeParse(request.query);
      const raw = queryParsed.success ? queryParsed.data : {};
      const limit = raw.limit ?? 10;
      const offset = raw.offset ?? 0;
      const q = raw.q;
      const sort = raw.sort ?? "newest";
      const likeEscape = (s: string) =>
        s.replace(/%/g, "\\%").replace(/_/g, "\\_");
      let whereClause = "user_id = ?";
      const params: (string | number)[] = [request.userId];
      if (q && q.trim()) {
        whereClause += " AND name LIKE ? ESCAPE '\\'";
        params.push(`%${likeEscape(q.trim())}%`);
      }
      const countResult = db
        .prepare(`SELECT COUNT(*) as count FROM api_keys WHERE ${whereClause}`)
        .get(...params) as { count: number };
      const total = countResult.count;
      const orderBy = sort === "oldest" ? "created_at ASC" : "created_at DESC";
      const keys = db
        .prepare(
          `SELECT id, name, valid_until, valid_from, COALESCE(disabled, 0) AS disabled, created_at, last_used_at
         FROM api_keys
         WHERE ${whereClause}
         ORDER BY ${orderBy}
         LIMIT ? OFFSET ?`,
        )
        .all(...params, limit, offset) as {
        id: string;
        name: string | null;
        valid_until: string | null;
        valid_from: string | null;
        disabled: number;
        created_at: string;
        last_used_at: string | null;
      }[];
      return { api_keys: keys, total };
    },
  );

  app.post(
    "/auth/api-keys",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Auth"],
        summary: "Create API key",
        description:
          "Generate a new API key. Optional name, valid_until (ISO), valid_from (ISO). Raw key returned only once. Max 5 per user. Requires session (not API key).",
        body: {
          type: "object",
          properties: {
            name: { type: "string" },
            valid_until: { type: "string", description: "ISO datetime" },
            valid_from: { type: "string", description: "ISO datetime" },
          },
        },
        response: {
          201: { description: "New key" },
          400: { description: "At key limit" },
          401: { description: "Unauthorized" },
          403: { description: "Use session or read-only" },
        },
      },
    },
    async (request, reply) => {
      if (
        !requireSession(request, reply as Parameters<typeof requireSession>[1])
      )
        return;
      const count = db
        .prepare("SELECT COUNT(*) as count FROM api_keys WHERE user_id = ?")
        .get(request.userId) as { count: number };
      if (count.count >= MAX_API_KEYS_PER_USER) {
        return reply.status(400).send({
          error: `You can have at most ${MAX_API_KEYS_PER_USER} API keys. Revoke one to create a new one.`,
        });
      }
      const bodyParsed = authApiKeyCreateBodySchema.safeParse(request.body);
      if (!bodyParsed.success) {
        return reply
          .status(400)
          .send({
            error:
              bodyParsed.error.issues[0]?.message ?? "Validation failed",
            details: bodyParsed.error.flatten(),
          });
      }
      const body = bodyParsed.data;
      const name = body.name?.trim() ?? null;
      const validUntil = body.valid_until?.trim() ?? null;
      const validFrom = body.valid_from?.trim() ?? null;
      const id = nanoid();
      const rawKey = API_KEY_PREFIX + randomBytes(32).toString("hex");
      const keyHash = sha256Hex(rawKey);
      db.prepare(
        "INSERT INTO api_keys (id, user_id, key_hash, name, valid_until, valid_from, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))",
      ).run(id, request.userId, keyHash, name, validUntil, validFrom);
      const row = db
        .prepare(
          "SELECT id, name, valid_until, valid_from, COALESCE(disabled, 0) AS disabled, created_at FROM api_keys WHERE id = ?",
        )
        .get(id) as {
        id: string;
        name: string | null;
        valid_until: string | null;
        valid_from: string | null;
        disabled: number;
        created_at: string;
      };
      return reply.status(201).send({
        id: row.id,
        key: rawKey,
        name: row.name,
        valid_until: row.valid_until,
        valid_from: row.valid_from,
        disabled: row.disabled,
        created_at: row.created_at,
      });
    },
  );

  app.patch(
    "/auth/api-keys/:id",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Auth"],
        summary: "Update API key",
        description:
          "Update an API key (name, valid_until, valid_from, disabled). Requires session (not API key).",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        body: {
          type: "object",
          properties: {
            name: { type: "string" },
            valid_until: { type: "string", description: "ISO datetime" },
            valid_from: { type: "string", description: "ISO datetime" },
            disabled: { type: "boolean" },
          },
        },
        response: {
          200: { description: "Updated key" },
          400: { description: "Validation failed" },
          401: { description: "Unauthorized" },
          403: { description: "Use session or read-only" },
          404: { description: "Key not found" },
        },
      },
    },
    async (request, reply) => {
      if (
        !requireSession(request, reply as Parameters<typeof requireSession>[1])
      )
        return;
      const paramsParsed = authApiKeyIdParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return reply
          .status(400)
          .send({
            error:
              paramsParsed.error.issues[0]?.message ?? "Validation failed",
            details: paramsParsed.error.flatten(),
          });
      }
      const { id } = paramsParsed.data;
      const existing = db
        .prepare("SELECT id FROM api_keys WHERE id = ? AND user_id = ?")
        .get(id, request.userId);
      if (!existing) {
        return reply.status(404).send({ error: "API key not found" });
      }
      const bodyParsed = authApiKeyUpdateBodySchema.safeParse(request.body);
      if (!bodyParsed.success) {
        return reply
          .status(400)
          .send({
            error:
              bodyParsed.error.issues[0]?.message ?? "Validation failed",
            details: bodyParsed.error.flatten(),
          });
      }
      const body = bodyParsed.data;
      const updates: string[] = [];
      const values: unknown[] = [];
      if (body.name !== undefined) {
        updates.push("name = ?");
        values.push(
          typeof body.name === "string" ? body.name.trim() || null : null,
        );
      }
      if (body.valid_until !== undefined) {
        updates.push("valid_until = ?");
        values.push(
          typeof body.valid_until === "string"
            ? body.valid_until.trim() || null
            : null,
        );
      }
      if (body.valid_from !== undefined) {
        updates.push("valid_from = ?");
        values.push(
          typeof body.valid_from === "string"
            ? body.valid_from.trim() || null
            : null,
        );
      }
      if (body.disabled !== undefined) {
        updates.push("disabled = ?");
        values.push(body.disabled ? 1 : 0);
      }
      if (updates.length === 0) {
        const row = db
          .prepare(
            "SELECT id, name, valid_until, valid_from, COALESCE(disabled, 0) AS disabled, created_at FROM api_keys WHERE id = ?",
          )
          .get(id) as {
          id: string;
          name: string | null;
          valid_until: string | null;
          valid_from: string | null;
          disabled: number;
          created_at: string;
        };
        return reply.send(row);
      }
      db.prepare(
        `UPDATE api_keys SET ${updates.join(", ")} WHERE id = ?`,
      ).run(...values, id);
      const row = db
        .prepare(
          "SELECT id, name, valid_until, valid_from, COALESCE(disabled, 0) AS disabled, created_at FROM api_keys WHERE id = ?",
        )
        .get(id) as {
        id: string;
        name: string | null;
        valid_until: string | null;
        valid_from: string | null;
        disabled: number;
        created_at: string;
      };
      return reply.send(row);
    },
  );

  app.delete(
    "/auth/api-keys/:id",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Auth"],
        summary: "Revoke API key",
        description:
          "Permanently revoke an API key. Requires session (not API key).",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        response: {
          204: { description: "Revoked" },
          400: { description: "Validation failed" },
          401: { description: "Unauthorized" },
          403: { description: "Use session or read-only" },
          404: { description: "Key not found" },
        },
      },
    },
    async (request, reply) => {
      if (
        !requireSession(request, reply as Parameters<typeof requireSession>[1])
      )
        return;
      const paramsParsed = authApiKeyIdParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return reply
          .status(400)
          .send({
            error:
              paramsParsed.error.issues[0]?.message ?? "Validation failed",
            details: paramsParsed.error.flatten(),
          });
      }
      const { id } = paramsParsed.data;
      const existing = db
        .prepare("SELECT id FROM api_keys WHERE id = ? AND user_id = ?")
        .get(id, request.userId);
      if (!existing) {
        return reply.status(404).send({ error: "API key not found" });
      }
      db.prepare("DELETE FROM api_keys WHERE id = ?").run(id);
      return reply.status(204).send();
    },
  );
}
