import type { FastifyInstance } from "fastify";
import send from "@fastify/send";
import { nanoid } from "nanoid";
import { basename, dirname, join, extname } from "path";
import { existsSync, unlinkSync, writeFileSync } from "fs";
import {
  castCreateSchema,
  castUpdateSchema,
  castListQuerySchema,
} from "@harborfm/shared";
import { requireAuth, requireNotReadOnly } from "../../plugins/auth.js";
import { db } from "../../db/index.js";
import {
  getPodcastRole,
  canAccessPodcast,
  canAddEditHost,
  canAddEditGuest,
} from "../../services/access.js";
import { assertPathUnder, assertResolvedPathUnder, castPhotoDir } from "../../services/paths.js";
import { ARTWORK_MAX_BYTES, ARTWORK_MAX_MB } from "../../config.js";
import { EXT_DOT_TO_MIMETYPE, MIMETYPE_TO_EXT } from "../../utils/artwork.js";
import { ARTWORK_FILENAME_REGEX } from "./utils.js";

type CastRow = {
  id: string;
  podcast_id: string;
  name: string;
  role: "host" | "guest";
  description: string | null;
  photo_path: string | null;
  photo_url: string | null;
  social_link_text: string | null;
  is_public: number;
  created_at: string;
};

function castRowToResponse(row: CastRow): Record<string, unknown> {
  const photoFilename =
    row.photo_path && row.podcast_id
      ? basename(row.photo_path)
      : null;
  return {
    id: row.id,
    podcast_id: row.podcast_id,
    name: row.name,
    role: row.role,
    description: row.description,
    photo_path: row.photo_path,
    photo_url: row.photo_url,
    photo_filename: photoFilename,
    social_link_text: row.social_link_text,
    is_public: row.is_public,
    created_at: row.created_at,
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
      const row = db
        .prepare("SELECT photo_path FROM podcast_cast WHERE id = ? AND podcast_id = ?")
        .get(castId, podcastId) as { photo_path: string | null } | undefined;
      if (!row?.photo_path || basename(row.photo_path) !== filename) {
        return reply.status(404).send({ error: "Not found" });
      }
      try {
        const safePath = assertPathUnder(row.photo_path, castPhotoDir(podcastId));
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
            episode_id: { type: "string" },
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
      const queryData = (query.success ? query.data : {}) as Record<string, unknown>;
      const limit = (queryData.limit as number | undefined) ?? 10;
      const offset = (queryData.offset as number | undefined) ?? 0;
      const q = (queryData.q as string | undefined) ?? "";
      const sort = (queryData.sort === "oldest" ? "oldest" : "newest") as "newest" | "oldest";
      const episode_id = (
        (queryData.episode_id as string | undefined) ??
        (request.query as { episode_id?: string }).episode_id ??
        ""
      ).trim();

      let whereClause = `podcast_id = ?`;
      const whereParams: (string | number)[] = [podcastId];

      if (q?.trim()) {
        whereClause += ` AND (name LIKE ? OR COALESCE(description, '') LIKE ?)`;
        const search = `%${q.trim()}%`;
        whereParams.push(search, search);
      }

      // Exclude cast already assigned to this episode
      if (episode_id) {
        const episodeExists = db
          .prepare("SELECT id FROM episodes WHERE id = ? AND podcast_id = ?")
          .get(episode_id, podcastId);
        if (episodeExists) {
          whereClause += ` AND id NOT IN (SELECT cast_id FROM episode_cast WHERE episode_id = ?)`;
          whereParams.push(episode_id);
        }
      }

      const countRow = db
        .prepare(`SELECT COUNT(*) as count FROM podcast_cast WHERE ${whereClause}`)
        .get(...whereParams) as { count: number } | undefined;
      const total = countRow?.count ?? 0;

      const orderDir = sort === "oldest" ? "ASC" : "DESC";
      const rows = db
        .prepare(
          `SELECT * FROM podcast_cast WHERE ${whereClause} ORDER BY created_at ${orderDir} LIMIT ? OFFSET ?`,
        )
        .all(...whereParams, limit, offset) as CastRow[];
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
      const existing = db
        .prepare("SELECT id FROM podcasts WHERE id = ?")
        .get(podcastId);
      if (!existing) {
        return reply.status(404).send({ error: "Podcast not found" });
      }

      const id = nanoid();
      const description = parsed.data.description?.trim() || null;
      const photoUrl = parsed.data.photo_url?.trim() || null;
      const socialLinkText = parsed.data.social_link_text?.trim() || null;
      const isPublic = parsed.data.is_public ?? 1;

      db.prepare(
        `INSERT INTO podcast_cast (id, podcast_id, name, role, description, photo_url, social_link_text, is_public)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        podcastId,
        parsed.data.name.trim(),
        castRole,
        description,
        photoUrl,
        socialLinkText,
        isPublic,
      );

      const row = db.prepare("SELECT * FROM podcast_cast WHERE id = ?").get(id) as CastRow;
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
      const existing = db
        .prepare("SELECT * FROM podcast_cast WHERE id = ? AND podcast_id = ?")
        .get(castId, podcastId) as CastRow | undefined;
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

      const updates: string[] = [];
      const values: unknown[] = [];

      if (parsed.data.name !== undefined) {
        updates.push("name = ?");
        values.push(parsed.data.name.trim());
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
        updates.push("role = ?");
        values.push(newRole);
      }
      if (parsed.data.description !== undefined) {
        updates.push("description = ?");
        values.push(parsed.data.description?.trim() || null);
      }
      if (parsed.data.photo_url !== undefined) {
        updates.push("photo_url = ?");
        values.push(parsed.data.photo_url?.trim() || null);
      }
      if (parsed.data.social_link_text !== undefined) {
        updates.push("social_link_text = ?");
        values.push(parsed.data.social_link_text?.trim() || null);
      }
      if (parsed.data.is_public !== undefined) {
        updates.push("is_public = ?");
        values.push(parsed.data.is_public);
      }

      if (updates.length === 0) {
        return castRowToResponse(existing);
      }
      values.push(castId, podcastId);
      db.prepare(
        `UPDATE podcast_cast SET ${updates.join(", ")} WHERE id = ? AND podcast_id = ?`,
      ).run(...values);

      const row = db.prepare("SELECT * FROM podcast_cast WHERE id = ?").get(castId) as CastRow;
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
      const existing = db
        .prepare("SELECT * FROM podcast_cast WHERE id = ? AND podcast_id = ?")
        .get(castId, podcastId) as CastRow | undefined;
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
      if (existing.photo_path) {
        try {
          const dir = castPhotoDir(podcastId);
          const safePath = assertPathUnder(existing.photo_path, dir);
          if (existsSync(safePath)) unlinkSync(safePath);
        } catch {
          // ignore
        }
      }
      db.prepare("DELETE FROM podcast_cast WHERE id = ? AND podcast_id = ?").run(
        castId,
        podcastId,
      );
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
      const existing = db
        .prepare("SELECT * FROM podcast_cast WHERE id = ? AND podcast_id = ?")
        .get(castId, podcastId) as CastRow | undefined;
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
      db.prepare(
        "UPDATE podcast_cast SET photo_path = ?, photo_url = NULL WHERE id = ? AND podcast_id = ?",
      ).run(destPath, castId, podcastId);
      const oldPath = existing.photo_path;
      if (oldPath && oldPath !== destPath) {
        try {
          const safeOld = assertPathUnder(oldPath, dir);
          if (existsSync(safeOld)) unlinkSync(safeOld);
        } catch {
          // ignore
        }
      }
      const row = db.prepare("SELECT * FROM podcast_cast WHERE id = ?").get(castId) as CastRow;
      return castRowToResponse(row);
    },
  );
}
