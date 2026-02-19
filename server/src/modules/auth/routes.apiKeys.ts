import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { randomBytes } from "crypto";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { requireAuth, requireNotReadOnly } from "../../plugins/auth.js";
import { drizzleDb } from "../../db/index.js";
import { isApiKeyLimitExceeded } from "../../db/utils.js";
import { apiKeys } from "../../db/schema.js";
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
        s.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
      const whereCond =
        q && q.trim()
          ? and(
              eq(apiKeys.userId, request.userId),
              sql`${apiKeys.name} LIKE ${`%${likeEscape(q.trim())}%`} ESCAPE '\\'`,
            )
          : eq(apiKeys.userId, request.userId);
      const countResult = drizzleDb
        .select({ count: sql<number>`count(*)`.as("count") })
        .from(apiKeys)
        .where(whereCond)
        .get();
      const total = countResult?.count ?? 0;
      const orderByCol =
        sort === "oldest" ? asc(apiKeys.createdAt) : desc(apiKeys.createdAt);
      const rows = drizzleDb
        .select({
          id: apiKeys.id,
          name: apiKeys.name,
          validUntil: apiKeys.validUntil,
          validFrom: apiKeys.validFrom,
          disabled: sql<number>`COALESCE(${apiKeys.disabled}, 0)`.as("disabled"),
          createdAt: apiKeys.createdAt,
          lastUsedAt: apiKeys.lastUsedAt,
        })
        .from(apiKeys)
        .where(whereCond)
        .orderBy(orderByCol)
        .limit(limit)
        .offset(offset)
        .all();
      return { apiKeys: rows, total };
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
          "Generate a new API key. Optional name, validUntil (ISO), validFrom (ISO). Raw key returned only once. Max 5 per user. Requires session (not API key).",
        body: {
          type: "object",
          properties: {
            name: { type: "string" },
            validUntil: { type: "string", description: "ISO datetime" },
            validFrom: { type: "string", description: "ISO datetime" },
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
      const count = drizzleDb
        .select({ count: sql<number>`count(*)`.as("count") })
        .from(apiKeys)
        .where(eq(apiKeys.userId, request.userId))
        .get();
      if ((count?.count ?? 0) >= MAX_API_KEYS_PER_USER) {
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
      const validUntil = body.validUntil?.trim() ?? null;
      const validFrom = body.validFrom?.trim() ?? null;
      const id = nanoid();
      const rawKey = API_KEY_PREFIX + randomBytes(32).toString("hex");
      const keyHash = sha256Hex(rawKey);
      try {
        drizzleDb.insert(apiKeys).values({
          id,
          userId: request.userId,
          keyHash,
          name,
          validUntil,
          validFrom,
        }).run();
      } catch (err) {
        if (isApiKeyLimitExceeded(err)) {
          return reply.status(400).send({
            error: `You can have at most ${MAX_API_KEYS_PER_USER} API keys. Revoke one to create a new one.`,
          });
        }
        throw err;
      }
      const row = drizzleDb
        .select({
          id: apiKeys.id,
          name: apiKeys.name,
          validUntil: apiKeys.validUntil,
          validFrom: apiKeys.validFrom,
          disabled: sql<number>`COALESCE(${apiKeys.disabled}, 0)`.as("disabled"),
          createdAt: apiKeys.createdAt,
        })
        .from(apiKeys)
        .where(eq(apiKeys.id, id))
        .limit(1)
        .get();
      return reply.status(201).send({
        id: row!.id,
        key: rawKey,
        name: row!.name,
        validUntil: row!.validUntil,
        validFrom: row!.validFrom,
        disabled: row!.disabled,
        createdAt: row!.createdAt,
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
          "Update an API key (name, validUntil, validFrom, disabled). Requires session (not API key).",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        body: {
          type: "object",
          properties: {
            name: { type: "string" },
            validUntil: { type: "string", description: "ISO datetime" },
            validFrom: { type: "string", description: "ISO datetime" },
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
      const existing = drizzleDb
        .select({ id: apiKeys.id })
        .from(apiKeys)
        .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, request.userId)))
        .limit(1)
        .get();
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
      const set: Record<string, unknown> = {};
      if (body.name !== undefined) {
        set.name =
          typeof body.name === "string" ? body.name.trim() || null : null;
      }
      if (body.validUntil !== undefined) {
        set.validUntil =
          typeof body.validUntil === "string"
            ? body.validUntil.trim() || null
            : null;
      }
      if (body.validFrom !== undefined) {
        set.validFrom =
          typeof body.validFrom === "string"
            ? body.validFrom.trim() || null
            : null;
      }
      if (body.disabled !== undefined) {
        set.disabled = body.disabled ? 1 : 0;
      }
      const apiKeySelect = {
        id: apiKeys.id,
        name: apiKeys.name,
        validUntil: apiKeys.validUntil,
        validFrom: apiKeys.validFrom,
        disabled: sql<number>`COALESCE(${apiKeys.disabled}, 0)`.as("disabled"),
        createdAt: apiKeys.createdAt,
      };
      if (Object.keys(set).length === 0) {
        const row = drizzleDb
          .select(apiKeySelect)
          .from(apiKeys)
          .where(eq(apiKeys.id, id))
          .limit(1)
          .get();
        return reply.send(row!);
      }
      drizzleDb
        .update(apiKeys)
        .set(set as Partial<typeof apiKeys.$inferInsert>)
        .where(eq(apiKeys.id, id))
        .run();
      const row = drizzleDb
        .select(apiKeySelect)
        .from(apiKeys)
        .where(eq(apiKeys.id, id))
        .limit(1)
        .get();
      return reply.send(row!);
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
      const existing = drizzleDb
        .select({ id: apiKeys.id })
        .from(apiKeys)
        .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, request.userId)))
        .limit(1)
        .get();
      if (!existing) {
        return reply.status(404).send({ error: "API key not found" });
      }
      drizzleDb
        .delete(apiKeys)
        .where(eq(apiKeys.id, id))
        .run();
      return reply.status(204).send();
    },
  );
}
