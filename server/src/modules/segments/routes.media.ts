import type { FastifyInstance } from "fastify";
import { existsSync, readFileSync } from "fs";
import { dirname, basename } from "path";
import send from "@fastify/send";
import { requireAuth } from "../../plugins/auth.js";
import { canAccessEpisode } from "../../services/access.js";
import { assertPathUnder, assertSafeId } from "../../services/paths.js";
import { contentTypeFromAudioPath } from "../../utils/audio.js";
import {
  segmentEpisodeSegmentIdParamSchema,
  segmentEpisodeIdOnlyParamSchema,
  segmentWaveformsBulkBodySnakeSchema,
} from "@harborfm/shared";
import * as repo from "./repo.js";
import { waveformPath } from "./utils.js";

export async function registerMediaRoutes(app: FastifyInstance) {
  app.get(
    "/episodes/:episodeId/segments/:segmentId/stream",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Segments"],
        summary: "Stream segment audio",
        description: "Stream segment audio file.",
        params: {
          type: "object",
          properties: {
            episodeId: { type: "string" },
            segmentId: { type: "string" },
          },
          required: ["episodeId", "segmentId"],
        },
        response: {
          200: { description: "Audio stream" },
          206: { description: "Partial content" },
          400: { description: "Validation failed" },
          404: { description: "Not found" },
          500: { description: "Send error" },
        },
      },
    },
    async (request, reply) => {
      const parsed = segmentEpisodeSegmentIdParamSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: parsed.error.issues[0]?.message ?? "Validation failed", details: parsed.error.flatten() });
      }
      const { episodeId, segmentId } = parsed.data;
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access)
        return reply.status(404).send({ error: "Episode not found" });
      const segment = repo.getSegmentById(segmentId, episodeId);
      if (!segment)
        return reply.status(404).send({ error: "Segment not found" });
      const audio = repo.getSegmentAudioPath(segment, access.podcastId, episodeId);
      if (!audio || !existsSync(audio.path))
        return reply.status(404).send({ error: "Segment audio not found" });
      const safePath = assertPathUnder(audio.path, audio.base);
      const contentType = contentTypeFromAudioPath(audio.path);

      const result = await send(request.raw, basename(safePath), {
        root: dirname(safePath),
        contentType: false,
        acceptRanges: true,
        cacheControl: false,
      });

      if (result.type === "error") {
        const err = result.metadata.error as Error & { status?: number };
        return reply
          .status((err.status ?? 500) as 404 | 500)
          .send({ error: err.message ?? "Internal Server Error" });
      }

      reply.status(result.statusCode as 200 | 206 | 404 | 500);
      const headers = result.headers as Record<string, string>;
      for (const [key, value] of Object.entries(headers)) {
        if (value !== undefined) reply.header(key, value);
      }
      reply
        .header("Content-Type", contentType)
        .header("Cache-Control", "private, no-transform");
      return reply.send(result.stream);
    },
  );

  app.post(
    "/episodes/:episodeId/segments/waveforms-bulk",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Segments"],
        summary: "Get multiple segment waveforms",
        description:
          "Returns waveform JSON for up to 10 segments at once. All must belong to the episode. Requires auth.",
        params: {
          type: "object",
          properties: { episodeId: { type: "string" } },
          required: ["episodeId"],
        },
        body: {
          type: "object",
          properties: {
            segment_ids: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 10 },
          },
          required: ["segment_ids"],
        },
        response: {
          200: { description: "Waveforms map" },
          400: { description: "Validation failed" },
          404: { description: "Episode not found" },
        },
      },
    },
    async (request, reply) => {
      const paramsParsed = segmentEpisodeIdOnlyParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return reply
          .status(400)
          .send({ error: paramsParsed.error.issues[0]?.message ?? "Validation failed", details: paramsParsed.error.flatten() });
      }
      const bodyParsed = segmentWaveformsBulkBodySnakeSchema.safeParse(request.body);
      if (!bodyParsed.success) {
        return reply
          .status(400)
          .send({ error: bodyParsed.error.issues[0]?.message ?? "Validation failed", details: bodyParsed.error.flatten() });
      }
      const segmentIds = bodyParsed.data.segment_ids;
      const { episodeId } = paramsParsed.data;
      try {
        assertSafeId(episodeId, "episodeId");
      } catch (err) {
        return reply.status(400).send({ error: err instanceof Error ? err.message : "Invalid episodeId" });
      }
      for (const segId of segmentIds) {
        try {
          assertSafeId(segId, "segmentId");
        } catch {
          return reply.status(400).send({ error: "Invalid segment ID in segment_ids" });
        }
      }
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access) return reply.status(404).send({ error: "Episode not found" });
      const waveforms: Record<string, unknown> = {};
      for (const segmentId of segmentIds) {
        const segment = repo.getSegmentById(segmentId, episodeId);
        if (!segment) continue;
        const audio = repo.getSegmentAudioPath(segment, access.podcastId, episodeId);
        if (!audio || !existsSync(audio.path)) continue;
        const wavPath = waveformPath(audio.path);
        if (!existsSync(wavPath)) continue;
        try {
          assertPathUnder(audio.path, audio.base);
          assertPathUnder(wavPath, audio.base);
          const json = readFileSync(wavPath, "utf-8");
          waveforms[segmentId] = JSON.parse(json);
        } catch {
          /* skip on read/parse error */
        }
      }
      reply.header("Cache-Control", "private, max-age=3600");
      return reply.send({ waveforms });
    },
  );

  app.get(
    "/episodes/:episodeId/segments/:segmentId/waveform",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Segments"],
        summary: "Get segment waveform",
        description: "Returns waveform JSON for a segment.",
        params: {
          type: "object",
          properties: {
            episodeId: { type: "string" },
            segmentId: { type: "string" },
          },
          required: ["episodeId", "segmentId"],
        },
        response: {
          200: { description: "Waveform JSON" },
          400: { description: "Validation failed" },
          404: { description: "Not found" },
        },
      },
    },
    async (request, reply) => {
      const parsed = segmentEpisodeSegmentIdParamSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: parsed.error.issues[0]?.message ?? "Validation failed", details: parsed.error.flatten() });
      }
      const { episodeId, segmentId } = parsed.data;
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access)
        return reply.status(404).send({ error: "Episode not found" });
      const segment = repo.getSegmentById(segmentId, episodeId);
      if (!segment)
        return reply.status(404).send({ error: "Segment not found" });
      const audio = repo.getSegmentAudioPath(segment, access.podcastId, episodeId);
      if (!audio || !existsSync(audio.path))
        return reply.status(404).send({ error: "Segment audio not found" });
      assertPathUnder(audio.path, audio.base);
      const wavPath = waveformPath(audio.path);
      if (!existsSync(wavPath))
        return reply.status(404).send({ error: "Waveform not found" });
      assertPathUnder(wavPath, audio.base);
      const json = readFileSync(wavPath, "utf-8");
      reply
        .header("Content-Type", "application/json")
        .header("Cache-Control", "private, max-age=3600");
      return reply.send(json);
    },
  );
}
