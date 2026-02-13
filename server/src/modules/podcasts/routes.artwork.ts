import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import send from "@fastify/send";
import { basename, dirname, join, extname } from "path";
import { existsSync, unlinkSync, writeFileSync } from "fs";
import { requireAuth, requireNotReadOnly } from "../../plugins/auth.js";
import { db } from "../../db/index.js";
import { getPodcastRole, canAccessPodcast, canEditEpisodeOrPodcastMetadata } from "../../services/access.js";
import { ARTWORK_MAX_BYTES, ARTWORK_MAX_MB } from "../../config.js";
import { assertPathUnder, assertResolvedPathUnder, artworkDir } from "../../services/paths.js";
import { EXT_DOT_TO_MIMETYPE, MIMETYPE_TO_EXT } from "../../utils/artwork.js";
import { podcastRowWithFilename, ARTWORK_FILENAME_REGEX } from "./utils.js";
import { getArtworkPath } from "./repo.js";

export async function registerArtworkRoutes(app: FastifyInstance) {
  app.get(
    "/podcasts/:id/artwork/:filename",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Podcasts"],
        summary: "Get podcast artwork (authenticated)",
        description:
          "Returns the podcast cover image. Requires access to the podcast. Use this in the app instead of /public/artwork when logged in.",
        params: {
          type: "object",
          properties: { id: { type: "string" }, filename: { type: "string" } },
          required: ["id", "filename"],
        },
        response: {
          200: { description: "Image binary" },
          206: { description: "Partial content" },
          404: { description: "Not found" },
          416: { description: "Range not satisfiable" },
        },
      },
    },
    async (request, reply) => {
      const { id: podcastId, filename } = request.params as {
        id: string;
        filename: string;
      };
      if (!canAccessPodcast(request.userId, podcastId)) {
        return reply.status(404).send({ error: "Not found" });
      }
      if (!ARTWORK_FILENAME_REGEX.test(filename)) {
        return reply.status(404).send({ error: "Not found" });
      }
      const artworkPath = getArtworkPath(podcastId);
      if (!artworkPath || basename(artworkPath) !== filename) {
        return reply.status(404).send({ error: "Not found" });
      }
      try {
        const safePath = assertPathUnder(
          artworkPath,
          artworkDir(podcastId),
        );
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
          const err = result.metadata.error as Error & { status?: number };
          const status = (err.status ?? 404) as 404 | 500;
          return reply
            .status(status === 500 ? 404 : status)
            .send({ error: err.message ?? "Not found" });
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

  app.post(
    "/podcasts/:id/artwork",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Podcasts"],
        summary: "Upload podcast artwork",
        description:
          "Upload cover image (multipart). Max 5MB. Requires read-write access.",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        response: {
          200: { description: "Artwork uploaded" },
          400: { description: "No file or not image" },
          404: { description: "Not found" },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const role = getPodcastRole(request.userId, id);
      if (!canEditEpisodeOrPodcastMetadata(role)) {
        return reply.status(404).send({ error: "Podcast not found" });
      }
      const existing = db
        .prepare("SELECT id, artwork_path FROM podcasts WHERE id = ?")
        .get(id) as { id: string; artwork_path: string | null } | undefined;
      if (!existing)
        return reply.status(404).send({ error: "Podcast not found" });
      const data = await request.file();
      if (!data) return reply.status(400).send({ error: "No file uploaded" });
      const mimetype = data.mimetype || "";
      if (!mimetype.startsWith("image/"))
        return reply.status(400).send({ error: "Not an image" });
      const ext = MIMETYPE_TO_EXT[mimetype] ?? "jpg";
      const dir = artworkDir(id);
      const filename = `${nanoid()}.${ext}`;
      const destPath = join(dir, filename);
      const buffer = await data.toBuffer();
      if (buffer.length > ARTWORK_MAX_BYTES)
        return reply
          .status(400)
          .send({ error: `Image too large (max ${ARTWORK_MAX_MB}MB)` });
      assertResolvedPathUnder(destPath, dir);
      writeFileSync(destPath, buffer);
      db.prepare(
        "UPDATE podcasts SET artwork_path = ?, artwork_url = NULL, updated_at = datetime('now') WHERE id = ?",
      ).run(destPath, id);
      const oldPath = existing.artwork_path;
      if (oldPath && oldPath !== destPath) {
        try {
          const safeOld = assertPathUnder(oldPath, dir);
          if (existsSync(safeOld)) unlinkSync(safeOld);
        } catch {
          // ignore
        }
      }
      const row = db
        .prepare("SELECT * FROM podcasts WHERE id = ?")
        .get(id) as Record<string, unknown>;
      return podcastRowWithFilename(row);
    },
  );
}
