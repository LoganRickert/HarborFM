import type { FastifyInstance } from "fastify";
import send from "@fastify/send";
import { recordRssRequest } from "../../services/podcastStats.js";
import { rssDir } from "../../services/paths.js";
import { isHumanUserAgent } from "../../utils/isBot.js";
import {
  generateRss,
  getCachedRssIfFresh,
  writeRssToFile,
} from "../../services/rss.js";
import { getUserAgent } from "../../services/loginAttempts.js";
import { RSS_CACHE_MAX_AGE_MS, RSS_FEED_FILENAME } from "../../config.js";
import * as repo from "./repo.js";

export async function registerRssRoutes(app: FastifyInstance) {
  app.get(
    "/public/podcasts/:podcastSlug/rss",
    {
      schema: {
        tags: ["Public"],
        summary: "Get RSS feed",
        description:
          "Returns the RSS feed XML for a podcast by slug. No authentication required.",
        security: [],
        params: {
          type: "object",
          properties: { podcastSlug: { type: "string" } },
          required: ["podcastSlug"],
        },
        response: {
          200: { description: "RSS XML" },
          206: { description: "Partial content (byte range)" },
          404: { description: "Podcast not found" },
          416: { description: "Range not satisfiable" },
          500: { description: "Failed to generate feed" },
        },
      },
    },
    async (request, reply) => {
      const { podcastSlug } = request.params as { podcastSlug: string };
      const podcast = repo.getPodcastMetaForFeed(podcastSlug);
      if (!podcast || podcast.publicFeedDisabled === 1)
        return reply.status(404).send({ error: "Podcast not found" });

      if (request.method === "GET") {
        const ua = getUserAgent(request);
        const isBot = !isHumanUserAgent(ua);
        recordRssRequest(podcast.id, isBot);
      }

      try {
        if (!getCachedRssIfFresh(podcast.id, RSS_CACHE_MAX_AGE_MS)) {
          const xml = generateRss(podcast.id, null);
          writeRssToFile(podcast.id, xml);
        }
        const root = rssDir(podcast.id);
        const result = await send(request.raw, RSS_FEED_FILENAME, {
          root,
          contentType: false,
          acceptRanges: true,
          cacheControl: true,
          maxAge: 3600,
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
        reply.header("Content-Type", "application/xml");
        return reply.send(result.stream);
      } catch (_err) {
        return reply.status(500).send({ error: "Failed to generate feed" });
      }
    },
  );
}
