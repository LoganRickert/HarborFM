import type { FastifyInstance } from "fastify";
import { podcastFeedPreviewBodySchema } from "@harborfm/shared";
import { requireAuth, requireNotReadOnly } from "../../plugins/auth.js";
import { userRateLimitPreHandler } from "../../services/rateLimit.js";
import { previewFeedChannel } from "../../services/importFeed.js";

export async function registerFeedPreviewRoutes(app: FastifyInstance) {
  app.post(
    "/podcasts/feed-preview",
    {
      preHandler: [
        requireAuth,
        requireNotReadOnly,
        userRateLimitPreHandler({ bucket: "feed-preview", windowMs: 2000 }),
      ],
      schema: {
        tags: ["Podcasts"],
        summary: "Preview remote RSS/Atom feed channel metadata",
        description:
          "Fetches a feed URL (SSRF-safe) and returns feedGuid, feedUrl, title, coverArtUrl, and homeUrl for podroll autofill.",
        body: {
          type: "object",
          properties: { feedUrl: { type: "string", format: "uri" } },
          required: ["feedUrl"],
        },
        response: {
          200: {
            description: "Channel preview",
            type: "object",
            properties: {
              feedGuid: { type: ["string", "null"] },
              feedUrl: { type: "string" },
              title: { type: "string" },
              coverArtUrl: { type: ["string", "null"] },
              homeUrl: { type: ["string", "null"] },
            },
            required: ["feedGuid", "feedUrl", "title", "coverArtUrl", "homeUrl"],
          },
          400: { description: "Invalid URL or feed" },
          403: { description: "Read-only" },
        },
      },
    },
    async (request, reply) => {
      const parsed = podcastFeedPreviewBodySchema.safeParse(request.body);
      if (!parsed.success) {
        const first =
          parsed.error.flatten().fieldErrors.feedUrl?.[0] ??
          parsed.error.message;
        return reply.status(400).send({ error: first });
      }
      try {
        const preview = await previewFeedChannel(parsed.data.feedUrl);
        return reply.send(preview);
      } catch (err) {
        request.log.warn({ err }, "feed-preview failed");
        return reply.status(400).send({
          error: err instanceof Error ? err.message : "Failed to fetch feed",
        });
      }
    },
  );
}
