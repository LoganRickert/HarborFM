import type { FastifyInstance } from "fastify";
import send from "@fastify/send";
import { nanoid } from "nanoid";
import { basename, dirname, join, extname } from "path";
import { existsSync, unlinkSync, writeFileSync } from "fs";
import { and, asc, desc, eq, notInArray, sql } from "drizzle-orm";
import {
  castCreateSchema,
  castUpdateSchema,
  castListQuerySchema,
} from "@harborfm/shared";
import { requireAuth, requireNotReadOnly } from "../../plugins/auth.js";
import { drizzleDb } from "../../db/index.js";
import { episodeCast, episodes, podcastCast, podcasts } from "../../db/schema.js";
import {
  getPodcastRole,
  canAccessPodcast,
  canAddEditHost,
  canAddEditGuest,
} from "../../services/access.js";
import { broadcastToPodcast } from "../../services/episodeBroadcast.js";
import {
  assertPathUnder,
  assertResolvedPathUnder,
  castPhotoDir,
  pathRelativeToData,
  resolveDataPath,
} from "../../services/paths.js";
import { ARTWORK_MAX_BYTES, ARTWORK_MAX_MB } from "../../config.js";
import { EXT_DOT_TO_MIMETYPE, MIMETYPE_TO_EXT } from "../../utils/artwork.js";
import { ARTWORK_FILENAME_REGEX } from "./utils.js";

/** Cast row from DB (camelCase). isPublic is 0/1 for API. */
type CastRow = {
  id: string;
  podcastId: string;
  name: string;
  role: "host" | "guest";
  description: string | null;
  photoPath: string | null;
  photoUrl: string | null;
  socialLinkText: string | null;
  isPublic: number;
  createdAt: string;
};

function castRowToResponse(row: CastRow): Record<string, unknown> {
  const photoFilename =
    row.photoPath && row.podcastId
      ? basename(row.photoPath)
      : null;
  return {
    id: row.id,
    podcastId: row.podcastId,
    name: row.name,
    role: row.role,
    description: row.description,
    photoPath: row.photoPath,
    photoUrl: row.photoUrl,
    photoFilename,
    socialLinkText: row.socialLinkText,
    isPublic: row.isPublic,
    createdAt: row.createdAt,
  };
}

function canEditCastForRole(
  userRole: string | null,
  castRole: "host" | "guest",
): boolean {
  if (castRole === "host") return canAddEditHost(userRole);
  return canAddEditGuest(userRole);
}

export async function registerCastRoutes(app: FastifyInstance) {
  app.get(
    "/podcasts/:podcastId/cast/:castId/artwork/:filename",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Podcasts"],
        summary: "Get cast photo (authenticated)",
        params: {
          type: "object",
          properties: {
            podcastId: { type: "string" },
            castId: { type: "string" },
            filename: { type: "string" },
          },
          required: ["podcastId", "castId", "filename"],
        },
        response: {
          200: { description: "Image" },
          206: { description: "Partial content" },
          416: { description: "Range not satisfiable" },
          404: { description: "Not found" },
        },
      },
    },
    async (request, reply) => {
      const { podcastId, castId, filename } = request.params as {
        podcastId: string;
        castId: string;
        filename: string;
      };
      if (!canAccessPodcast(request.userId, podcastId)) {
        return reply.status(404).send({ error: "Not found" });
      }
      if (!ARTWORK_FILENAME_REGEX.test(filename)) {
        return reply.status(404).send({ error: "Not found" });
      }
      const row = drizzleDb
        .select({ photoPath: podcastCast.photoPath })
        .from(podcastCast)
        .where(
          and(
            eq(podcastCast.id, castId),
            eq(podcastCast.podcastId, podcastId),
          ),
        )
        .limit(1)
        .get();
      const photoPath = row?.photoPath ? resolveDataPath(row.photoPath) : "";
      if (!photoPath || basename(photoPath) !== filename) {
        return reply.status(404).send({ error: "Not found" });
      }
      try {
        const safePath = assertPathUnder(photoPath, castPhotoDir(podcastId));
        const ext = extname(safePath).toLowerCase();
        const contentType = EXT_DOT_TO_MIMETYPE[ext] ?? "image/jpeg";
        const result = await send(request.raw, basename(safePath), {
          root: dirname(safePath),
          contentType: false,
          acceptRanges: true,
          cacheControl: true,
          maxAge: 86400,
        });
        if (result.type === "error") {
          return reply.status(404).send({ error: "Not found" });
        }
        reply.status(result.statusCode as 200 | 206 | 416);
        const headers = result.headers as Record<string, string>;
        for (const [key, value] of Object.entries(headers)) {
          if (value !== undefined) reply.header(key, value);
        }
        reply.header("Content-Type", contentType);
        return reply.send(result.stream);
      } catch {
        return reply.status(404).send({ error: "Not found" });
      }
    },
  );

  app.get(
    "/podcasts/:podcastId/cast",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Podcasts"],
        summary: "List cast",
        description: "List show cast (hosts and guests) with pagination.",
        params: {
          type: "object",
          properties: { podcastId: { type: "string" } },
          required: ["podcastId"],
        },
        querystring: {
          type: "object",
          properties: {
            limit: { type: "integer" },
            offset: { type: "integer" },
            q: { type: "string" },
            sort: { type: "string", enum: ["newest", "oldest"] },
            episodeId: { type: "string" },
          },
        },
        response: {
          200: { description: "List of cast with total" },
          404: { description: "Podcast not found" },
        },
      },
    },
    async (request, reply) => {
      const { podcastId } = request.params as { podcastId: string };
      if (!canAccessPodcast(request.userId, podcastId)) {
        return reply.status(404).send({ error: "Podcast not found" });
      }
      const query = castListQuerySchema.safeParse(request.query);
      const queryData = query.success ? query.data : undefined;
      const limit = queryData?.limit ?? 10;
      const offset = queryData?.offset ?? 0;
      const q = queryData?.q ?? "";
      const sort = (queryData?.sort === "oldest" ? "oldest" : "newest") as "newest" | "oldest";
      const episodeId = (queryData?.episodeId ?? "").trim();

      const conditions = [eq(podcastCast.podcastId, podcastId)];
      if (q?.trim()) {
        const search = `%${q.trim()}%`;
        conditions.push(
          sql`(${podcastCast.name} LIKE ${search} OR COALESCE(${podcastCast.description}, '') LIKE ${search})`,
        );
      }
      if (episodeId) {
        const episodeExists = drizzleDb
          .select({ id: episodes.id })
          .from(episodes)
          .where(
            and(
              eq(episodes.id, episodeId),
              eq(episodes.podcastId, podcastId),
            ),
          )
          .limit(1)
          .get();
        if (episodeExists) {
          const assignedCastSubquery = drizzleDb
            .select({ castId: episodeCast.castId })
            .from(episodeCast)
            .where(eq(episodeCast.episodeId, episodeId));
          conditions.push(
            notInArray(podcastCast.id, assignedCastSubquery),
          );
        }
      }
      const whereClause = and(...conditions);

      const countRow = drizzleDb
        .select({ count: sql<number>`COUNT(*)`.as("count") })
        .from(podcastCast)
        .where(whereClause)
        .get();
      const total = countRow?.count ?? 0;

      const orderBy =
        sort === "oldest"
          ? asc(podcastCast.createdAt)
          : desc(podcastCast.createdAt);
      const rows = drizzleDb
        .select({
          id: podcastCast.id,
          podcastId: podcastCast.podcastId,
          name: podcastCast.name,
          role: podcastCast.role,
          description: podcastCast.description,
          photoPath: podcastCast.photoPath,
          photoUrl: podcastCast.photoUrl,
          socialLinkText: podcastCast.socialLinkText,
          isPublic: sql<number>`COALESCE(${podcastCast.isPublic}, 1)`.as("isPublic"),
          createdAt: podcastCast.createdAt,
        })
        .from(podcastCast)
        .where(whereClause)
        .orderBy(orderBy)
        .limit(limit)
        .offset(offset)
        .all() as CastRow[];
      return { cast: rows.map(castRowToResponse), total };
    },
  );

  app.post(
    "/podcasts/:podcastId/cast",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Podcasts"],
        summary: "Create cast member",
        params: {
          type: "object",
          properties: { podcastId: { type: "string" } },
          required: ["podcastId"],
        },
        body: { type: "object" },
        response: {
          201: { description: "Created" },
          400: { description: "Validation failed" },
          403: { description: "Permission denied" },
          404: { description: "Podcast not found" },
        },
      },
    },
    async (request, reply) => {
      const { podcastId } = request.params as { podcastId: string };
      const role = getPodcastRole(request.userId, podcastId);
      const parsed = castCreateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: parsed.error.issues[0]?.message ?? "Validation failed",
          details: parsed.error.flatten(),
        });
      }
      const castRole = parsed.data.role as "host" | "guest";
      if (!canEditCastForRole(role, castRole)) {
        return reply.status(403).send({
          error: castRole === "host"
            ? "Only owners and managers can add hosts."
            : "You do not have permission to add cast members.",
        });
      }
      const existing = drizzleDb
        .select({ id: podcasts.id })
        .from(podcasts)
        .where(eq(podcasts.id, podcastId))
        .limit(1)
        .get();
      if (!existing) {
        return reply.status(404).send({ error: "Podcast not found" });
      }

      const id = nanoid();
      const description = parsed.data.description?.trim() || null;
      const photoUrl = parsed.data.photoUrl?.trim() || null;
      const socialLinkText = parsed.data.socialLinkText?.trim() || null;
      const isPublic = parsed.data.isPublic ?? 1;

      drizzleDb
        .insert(podcastCast)
        .values({
          id,
          podcastId,
          name: parsed.data.name.trim(),
          role: castRole,
          description,
          photoUrl,
          socialLinkText,
          isPublic: isPublic !== 0,
        })
        .run();

      const row = drizzleDb
        .select({
          id: podcastCast.id,
          podcastId: podcastCast.podcastId,
          name: podcastCast.name,
          role: podcastCast.role,
          description: podcastCast.description,
          photoPath: podcastCast.photoPath,
          photoUrl: podcastCast.photoUrl,
          socialLinkText: podcastCast.socialLinkText,
          isPublic: sql<number>`COALESCE(${podcastCast.isPublic}, 1)`.as("isPublic"),
          createdAt: podcastCast.createdAt,
        })
        .from(podcastCast)
        .where(eq(podcastCast.id, id))
        .limit(1)
        .get() as CastRow;
      broadcastToPodcast(podcastId, { type: "showCastChanged" });
      return reply.status(201).send(castRowToResponse(row));
    },
  );

  app.patch(
    "/podcasts/:podcastId/cast/:castId",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Podcasts"],
        summary: "Update cast member",
        params: {
          type: "object",
          properties: {
            podcastId: { type: "string" },
            castId: { type: "string" },
          },
          required: ["podcastId", "castId"],
        },
        body: { type: "object" },
        response: {
          200: { description: "Updated" },
          400: { description: "Validation failed" },
          403: { description: "Permission denied" },
          404: { description: "Not found" },
        },
      },
    },
    async (request, reply) => {
      const { podcastId, castId } = request.params as { podcastId: string; castId: string };
      const role = getPodcastRole(request.userId, podcastId);
      const existing = drizzleDb
        .select()
        .from(podcastCast)
        .where(
          and(
            eq(podcastCast.id, castId),
            eq(podcastCast.podcastId, podcastId),
          ),
        )
        .limit(1)
        .get() as CastRow | undefined;
      if (!existing) {
        return reply.status(404).send({ error: "Cast member not found" });
      }
      const castRole = existing.role as "host" | "guest";
      if (!canEditCastForRole(role, castRole)) {
        return reply.status(403).send({
          error: castRole === "host"
            ? "Only owners and managers can edit hosts."
            : "You do not have permission to edit this cast member.",
        });
      }

      const parsed = castUpdateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: parsed.error.issues[0]?.message ?? "Validation failed",
          details: parsed.error.flatten(),
        });
      }

      const set: Partial<{
        name: string;
        role: "host" | "guest";
        description: string | null;
        photoUrl: string | null;
        socialLinkText: string | null;
        isPublic: boolean;
      }> = {};
      if (parsed.data.name !== undefined) {
        set.name = parsed.data.name.trim();
      }
      if (parsed.data.role !== undefined) {
        const newRole = parsed.data.role as "host" | "guest";
        if (!canEditCastForRole(role, newRole)) {
          return reply.status(403).send({
            error: newRole === "host"
              ? "Only owners and managers can set role to host."
              : "Permission denied.",
          });
        }
        set.role = newRole;
      }
      if (parsed.data.description !== undefined) {
        set.description = parsed.data.description?.trim() || null;
      }
      if (parsed.data.photoUrl !== undefined) {
        set.photoUrl = parsed.data.photoUrl?.trim() || null;
      }
      if (parsed.data.socialLinkText !== undefined) {
        set.socialLinkText = parsed.data.socialLinkText?.trim() || null;
      }
      if (parsed.data.isPublic !== undefined) {
        set.isPublic = parsed.data.isPublic !== 0;
      }

      if (Object.keys(set).length === 0) {
        return castRowToResponse(existing);
      }
      drizzleDb
        .update(podcastCast)
        .set(set)
        .where(
          and(
            eq(podcastCast.id, castId),
            eq(podcastCast.podcastId, podcastId),
          ),
        )
        .run();

      broadcastToPodcast(podcastId, { type: "showCastChanged" });
      const row = drizzleDb
        .select({
          id: podcastCast.id,
          podcastId: podcastCast.podcastId,
          name: podcastCast.name,
          role: podcastCast.role,
          description: podcastCast.description,
          photoPath: podcastCast.photoPath,
          photoUrl: podcastCast.photoUrl,
          socialLinkText: podcastCast.socialLinkText,
          isPublic: sql<number>`COALESCE(${podcastCast.isPublic}, 1)`.as("isPublic"),
          createdAt: podcastCast.createdAt,
        })
        .from(podcastCast)
        .where(eq(podcastCast.id, castId))
        .limit(1)
        .get() as CastRow;
      return castRowToResponse(row);
    },
  );

  app.delete(
    "/podcasts/:podcastId/cast/:castId",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Podcasts"],
        summary: "Delete cast member",
        params: {
          type: "object",
          properties: {
            podcastId: { type: "string" },
            castId: { type: "string" },
          },
          required: ["podcastId", "castId"],
        },
        response: {
          204: { description: "Deleted" },
          403: { description: "Permission denied" },
          404: { description: "Not found" },
        },
      },
    },
    async (request, reply) => {
      const { podcastId, castId } = request.params as { podcastId: string; castId: string };
      const role = getPodcastRole(request.userId, podcastId);
      const existing = drizzleDb
        .select()
        .from(podcastCast)
        .where(
          and(
            eq(podcastCast.id, castId),
            eq(podcastCast.podcastId, podcastId),
          ),
        )
        .limit(1)
        .get() as CastRow | undefined;
      if (!existing) {
        return reply.status(404).send({ error: "Cast member not found" });
      }
      const castRole = existing.role as "host" | "guest";
      if (!canEditCastForRole(role, castRole)) {
        return reply.status(403).send({
          error: castRole === "host"
            ? "Only owners and managers can delete hosts."
            : "You do not have permission to delete this cast member.",
        });
      }
      if (existing.photoPath) {
        try {
          const dir = castPhotoDir(podcastId);
          const safePath = assertPathUnder(
            resolveDataPath(existing.photoPath),
            dir,
          );
          if (existsSync(safePath)) unlinkSync(safePath);
        } catch {
          // ignore
        }
      }
      drizzleDb
        .delete(podcastCast)
        .where(
          and(
            eq(podcastCast.id, castId),
            eq(podcastCast.podcastId, podcastId),
          ),
        );
      broadcastToPodcast(podcastId, { type: "showCastChanged" });
      return reply.status(204).send();
    },
  );

  app.post(
    "/podcasts/:podcastId/cast/:castId/photo",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Podcasts"],
        summary: "Upload cast photo",
        params: {
          type: "object",
          properties: {
            podcastId: { type: "string" },
            castId: { type: "string" },
          },
          required: ["podcastId", "castId"],
        },
        response: {
          200: { description: "Photo uploaded" },
          400: { description: "No file or not image" },
          404: { description: "Not found" },
        },
      },
    },
    async (request, reply) => {
      const { podcastId, castId } = request.params as { podcastId: string; castId: string };
      const role = getPodcastRole(request.userId, podcastId);
      const existing = drizzleDb
        .select()
        .from(podcastCast)
        .where(
          and(
            eq(podcastCast.id, castId),
            eq(podcastCast.podcastId, podcastId),
          ),
        )
        .limit(1)
        .get() as CastRow | undefined;
      if (!existing) {
        return reply.status(404).send({ error: "Cast member not found" });
      }
      const castRole = existing.role as "host" | "guest";
      if (!canEditCastForRole(role, castRole)) {
        return reply.status(404).send({ error: "Cast member not found" });
      }
      const data = await request.file();
      if (!data) return reply.status(400).send({ error: "No file uploaded" });
      const mimetype = data.mimetype || "";
      if (!mimetype.startsWith("image/")) {
        return reply.status(400).send({ error: "Not an image" });
      }
      const ext = MIMETYPE_TO_EXT[mimetype] ?? "jpg";
      const dir = castPhotoDir(podcastId);
      const filename = `${castId}.${ext}`;
      const destPath = join(dir, filename);
      const buffer = await data.toBuffer();
      if (buffer.length > ARTWORK_MAX_BYTES) {
        return reply
          .status(400)
          .send({ error: `Image too large (max ${ARTWORK_MAX_MB}MB)` });
      }
      assertResolvedPathUnder(destPath, dir);
      writeFileSync(destPath, buffer);
      drizzleDb
        .update(podcastCast)
        .set({
          photoPath: pathRelativeToData(destPath),
          photoUrl: null,
        })
        .where(
          and(
            eq(podcastCast.id, castId),
            eq(podcastCast.podcastId, podcastId),
          ),
        )
        .run();
      broadcastToPodcast(podcastId, { type: "showCastChanged" });
      const oldPath = existing.photoPath
        ? resolveDataPath(existing.photoPath)
        : "";
      if (oldPath && oldPath !== destPath) {
        try {
          const safeOld = assertPathUnder(oldPath, dir);
          if (existsSync(safeOld)) unlinkSync(safeOld);
        } catch {
          // ignore
        }
      }
      const row = drizzleDb
        .select({
          id: podcastCast.id,
          podcastId: podcastCast.podcastId,
          name: podcastCast.name,
          role: podcastCast.role,
          description: podcastCast.description,
          photoPath: podcastCast.photoPath,
          photoUrl: podcastCast.photoUrl,
          socialLinkText: podcastCast.socialLinkText,
          isPublic: sql<number>`COALESCE(${podcastCast.isPublic}, 1)`.as("isPublic"),
          createdAt: podcastCast.createdAt,
        })
        .from(podcastCast)
        .where(eq(podcastCast.id, castId))
        .limit(1)
        .get() as CastRow;
      return castRowToResponse(row);
    },
  );
}
