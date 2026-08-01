import type { FastifyInstance } from "fastify";
import { getClientIp, getUserAgent } from "../../services/loginAttempts.js";
import {
  clientKey,
  recordRetentionReach,
} from "../../services/podcastStats.js";
import { drizzleDb } from "../../db/drizzle.js";
import { episodes } from "../../db/schema.js";
import { and, eq } from "drizzle-orm";

/**
 * Public website-player retention beacon (no auth).
 * Used by HarborFM feed/theme players.
 */
export async function registerRetentionRoutes(app: FastifyInstance) {
  app.post(
    "/public/analytics/retention",
    {
      schema: {
        tags: ["Public"],
        summary: "Record website player retention progress",
        description:
          "Client-confirmed playhead reach for HarborFM site/theme players.",
        security: [],
        body: {
          type: "object",
          required: ["episodeId", "percent"],
          properties: {
            episodeId: { type: "string" },
            percent: { type: "number" },
          },
        },
        response: {
          204: { description: "Recorded" },
          400: { description: "Invalid body" },
          404: { description: "Episode not found" },
        },
      },
    },
    async (request, reply) => {
      const body = request.body as {
        episodeId?: unknown;
        percent?: unknown;
      };
      const episodeId =
        typeof body?.episodeId === "string" ? body.episodeId.trim() : "";
      const percent =
        typeof body?.percent === "number" ? body.percent : Number.NaN;
      if (
        !episodeId ||
        episodeId.length > 64 ||
        !Number.isFinite(percent) ||
        percent < 0 ||
        percent > 100
      ) {
        return reply.status(400).send({ error: "Invalid body" });
      }
      const ep = drizzleDb
        .select({ id: episodes.id, status: episodes.status })
        .from(episodes)
        .where(and(eq(episodes.id, episodeId), eq(episodes.status, "published")))
        .limit(1)
        .get();
      if (!ep) return reply.status(404).send({ error: "Not found" });

      const ip = getClientIp(request);
      const ua = getUserAgent(request);
      const acceptLanguage =
        (request.headers["accept-language"] as string) ?? "";
      const ck = clientKey(ip, ua, acceptLanguage);
      recordRetentionReach(episodeId, ck, percent);
      return reply.status(204).send();
    },
  );
}
