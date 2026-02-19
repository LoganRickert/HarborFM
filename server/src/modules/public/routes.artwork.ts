import type { FastifyInstance } from "fastify";
import send from "@fastify/send";
import { basename, dirname, extname } from "path";
import { assertPathUnder, assertSafeId, artworkDir, castPhotoDir, resolveDataPath } from "../../services/paths.js";
import { EXT_DOT_TO_MIMETYPE } from "../../utils/artwork.js";
import { ARTWORK_FILENAME_REGEX } from "./utils.js";
import * as repo from "./repo.js";

export async function registerArtworkRoutes(app: FastifyInstance) {
  app.get(
    "/public/artwork/:podcastId/episodes/:episodeId/:filename",
    {
      schema: {
        tags: ["Public"],
        summary: "Get episode artwork",
        description:
          "Returns the episode cover image (PNG/WebP/JPG). No authentication required.",
        security: [],
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
          206: { description: "Partial content (byte range)" },
          404: { description: "Not found" },
          416: { description: "Range not satisfiable" },
          500: { description: "Server error" },
        },
      },
    },
    async (request, reply) => {
      const { podcastId, episodeId, filename } = request.params as {
        podcastId: string;
        episodeId: string;
        filename: string;
      };
      try {
        assertSafeId(podcastId, "podcastId");
        assertSafeId(episodeId, "episodeId");
      } catch {
        return reply.status(404).send({ error: "Not found" });
      }
      if (!ARTWORK_FILENAME_REGEX.test(filename)) {
        return reply.status(404).send({ error: "Not found" });
      }
      const artworkPath = repo.getEpisodeArtworkPath(episodeId, podcastId);
      if (!artworkPath || basename(artworkPath) !== filename) {
        return reply.status(404).send({ error: "Not found" });
      }
      const episodeArtworkPathResolved = resolveDataPath(artworkPath);
      try {
        const safePath = assertPathUnder(
          episodeArtworkPathResolved,
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
            .status(status)
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

  app.get(
    "/public/artwork/:podcastId/:filename",
    {
      schema: {
        tags: ["Public"],
        summary: "Get podcast artwork",
        description:
          "Returns the podcast/show cover image (PNG/WebP/JPG). No authentication required.",
        security: [],
        params: {
          type: "object",
          properties: {
            podcastId: { type: "string" },
            filename: { type: "string" },
          },
          required: ["podcastId", "filename"],
        },
        response: {
          200: { description: "Image binary" },
          206: { description: "Partial content (byte range)" },
          404: { description: "Not found" },
          416: { description: "Range not satisfiable" },
          500: { description: "Server error" },
        },
      },
    },
    async (request, reply) => {
      const { podcastId, filename } = request.params as {
        podcastId: string;
        filename: string;
      };
      try {
        assertSafeId(podcastId, "podcastId");
      } catch {
        return reply.status(404).send({ error: "Not found" });
      }
      if (!ARTWORK_FILENAME_REGEX.test(filename)) {
        return reply.status(404).send({ error: "Not found" });
      }
      const artworkPath = repo.getPodcastArtworkPath(podcastId);
      if (!artworkPath || basename(artworkPath) !== filename) {
        return reply.status(404).send({ error: "Not found" });
      }
      const artworkPathResolved = resolveDataPath(artworkPath);
      try {
        const safePath = assertPathUnder(
          artworkPathResolved,
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
            .status(status)
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

  app.get(
    "/public/artwork/:podcastId/cast/:castId/:filename",
    {
      schema: {
        tags: ["Public"],
        summary: "Get cast photo",
        description:
          "Returns a cast member photo (PNG/WebP/JPG). No authentication required.",
        security: [],
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
          200: { description: "Image binary" },
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
      try {
        assertSafeId(podcastId, "podcastId");
        assertSafeId(castId, "castId");
      } catch {
        return reply.status(404).send({ error: "Not found" });
      }
      if (!ARTWORK_FILENAME_REGEX.test(filename)) {
        return reply.status(404).send({ error: "Not found" });
      }
      const photoPath = repo.getCastPhotoPath(castId, podcastId);
      if (!photoPath || basename(photoPath) !== filename) {
        return reply.status(404).send({ error: "Not found" });
      }
      const photoPathResolved = resolveDataPath(photoPath);
      try {
        const safePath = assertPathUnder(photoPathResolved, castPhotoDir(podcastId));
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
}
