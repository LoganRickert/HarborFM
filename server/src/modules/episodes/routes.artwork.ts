import type { FastifyInstance } from "fastify";
import send from "@fastify/send";
import { existsSync, unlinkSync, writeFileSync } from "fs";
import { basename, dirname, extname, join } from "path";
import { nanoid } from "nanoid";
import { requireAuth, requireNotReadOnly } from "../../plugins/auth.js";
import { pathRelativeToData, resolveDataPath } from "../../services/paths.js";
import { assertPathUnder, assertResolvedPathUnder, artworkDir } from "../../services/paths.js";
import { canAccessEpisode, canEditEpisodeOrPodcastMetadata } from "../../services/access.js";
import { broadcastToEpisode } from "../../services/episodeBroadcast.js";
import { deleteTokenFeedTemplateFile, writeRssFile } from "../../services/rss.js";
import { notifyWebSubHub } from "../../services/websub.js";
import { EXT_DOT_TO_MIMETYPE, MIMETYPE_TO_EXT } from "../../utils/artwork.js";
import { ARTWORK_MAX_BYTES, ARTWORK_MAX_MB } from "../../config.js";
import { sqlNow } from "../../db/utils.js";
import { episodeRowWithFilename, ARTWORK_FILENAME_REGEX } from "./utils.js";
import * as repo from "./repo.js";

export async function registerArtworkRoutes(app: FastifyInstance) {
  app.get(
    "/podcasts/:podcastId/episodes/:episodeId/artwork/:filename",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Episodes"],
        summary: "Get episode artwork (authenticated)",
        description:
          "Returns the episode cover image. Requires access to the podcast. Use this in the app instead of /public/artwork when logged in.",
        params: {
          type: "object",
          properties: {
            podcastId: { type: "string" },
            episodeId: { type: "string" },
            filename: { type: "string" },
          },
          required: ["podcastId", "episodeId", "filename"],
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
      const { podcastId, episodeId, filename } = request.params as {
        podcastId: string;
        episodeId: string;
        filename: string;
      };
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access) return reply.status(404).send({ error: "Not found" });
      if (!ARTWORK_FILENAME_REGEX.test(filename))
        return reply.status(404).send({ error: "Not found" });
      const pathRaw = repo.getArtworkPath(episodeId, podcastId);
      const artworkPath = pathRaw ? resolveDataPath(pathRaw) : "";
      if (!artworkPath || basename(artworkPath) !== filename)
        return reply.status(404).send({ error: "Not found" });
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
    "/podcasts/:podcastId/episodes/:episodeId/artwork",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Episodes"],
        summary: "Upload episode artwork",
        description:
          "Upload episode cover image (multipart). Max 5MB. Requires read-write access.",
        params: {
          type: "object",
          properties: {
            podcastId: { type: "string" },
            episodeId: { type: "string" },
          },
          required: ["podcastId", "episodeId"],
        },
        response: {
          200: { description: "Artwork uploaded" },
          400: { description: "No file or not image" },
          404: { description: "Not found" },
        },
      },
    },
    async (request, reply) => {
      const { podcastId, episodeId } = request.params as {
        podcastId: string;
        episodeId: string;
      };
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access || !canEditEpisodeOrPodcastMetadata(access.role)) {
        return reply.status(404).send({ error: "Episode not found" });
      }
      const existing = repo.getById(episodeId);
      if (!existing || existing.podcastId !== podcastId)
        return reply.status(404).send({ error: "Episode not found" });
      const oldArtworkPath = existing.artworkPath ?? null;
      const data = await request.file();
      if (!data) return reply.status(400).send({ error: "No file uploaded" });
      const mimetype = data.mimetype || "";
      if (!mimetype.startsWith("image/"))
        return reply.status(400).send({ error: "Not an image" });
      const ext = MIMETYPE_TO_EXT[mimetype] ?? "jpg";
      const dir = artworkDir(podcastId);
      const filename = `${nanoid()}.${ext}`;
      const destPath = join(dir, filename);
      const buffer = await data.toBuffer();
      if (buffer.length > ARTWORK_MAX_BYTES)
        return reply
          .status(400)
          .send({ error: `Image too large (max ${ARTWORK_MAX_MB}MB)` });
      assertResolvedPathUnder(destPath, dir);
      writeFileSync(destPath, buffer);
      repo.updateEpisode(episodeId, {
        artworkPath: pathRelativeToData(destPath),
        artworkUrl: null,
        updatedAt: sqlNow(),
      });
      if (oldArtworkPath) {
        const oldPath = resolveDataPath(oldArtworkPath);
        if (oldPath && oldPath !== destPath) {
          try {
            const safeOld = assertPathUnder(oldPath, dir);
            if (existsSync(safeOld)) unlinkSync(safeOld);
          } catch {
            // ignore
          }
        }
      }
      try {
        writeRssFile(podcastId, null);
        deleteTokenFeedTemplateFile(podcastId);
        notifyWebSubHub(podcastId, null);
      } catch (_) {
        // non-fatal
      }
      broadcastToEpisode(episodeId, { type: "episodeUpdated" });
      const row = repo.getById(episodeId);
      if (!row) return reply.status(404).send({ error: "Episode not found" });
      return episodeRowWithFilename(row);
    },
  );
}
