import type { FastifyInstance } from "fastify";
import { existsSync, readFileSync } from "fs";
import { basename, dirname } from "path";
import send from "@fastify/send";
import { API_PREFIX, WAVEFORM_EXTENSION } from "../../config.js";
import { assertPathUnder, processedDir, resolveDataPath } from "../../services/paths.js";
import {
  buildEpisodeAlertEpisodeUrl,
  getEpisodeAlertPublicOrigin,
} from "../episodeAlerts/publicUrls.js";
import { notifyHostOfGuestReviewResponse } from "./notify.js";
import {
  isFullyPublic,
  isPreviewEligible,
  resolveReviewFromRawToken,
  setReviewApproved,
  setReviewFeedback,
  type EpisodeReviewContext,
} from "./repo.js";

function assertPreviewMediaAccess(episode: EpisodeReviewContext): boolean {
  return isPreviewEligible(episode) && !isFullyPublic(episode);
}

function rawTokenFromQuery(query: unknown): string {
  const q = query as { token?: string | string[] };
  const raw = Array.isArray(q.token) ? q.token[0] : q.token;
  return typeof raw === "string" ? raw.trim() : "";
}

function rawTokenFromBody(body: unknown): string {
  const b = body as { token?: unknown };
  return typeof b.token === "string" ? b.token.trim() : "";
}

export async function registerEpisodeGuestReviewPublicRoutes(
  app: FastifyInstance,
) {
  app.get(
    "/public/episode-review",
    {
      schema: {
        tags: ["Public"],
        summary: "Resolve guest episode review token",
        security: [],
        querystring: {
          type: "object",
          properties: { token: { type: "string" } },
          required: ["token"],
        },
      },
    },
    async (request, reply) => {
      const token = rawTokenFromQuery(request.query);
      const resolved = resolveReviewFromRawToken(token);
      if (!resolved) {
        return reply.status(200).send({ state: "invalid" });
      }
      const { review, episode } = resolved;
      const episodeUrl = buildEpisodeAlertEpisodeUrl(
        episode.podcastId,
        episode.podcastSlug,
        episode.slug,
      );
      const origin = getEpisodeAlertPublicOrigin(episode.podcastId);

      if (isFullyPublic(episode)) {
        return reply.status(200).send({
          state: "redirect_public",
          episodeUrl,
          podcastSlug: episode.podcastSlug,
          episodeSlug: episode.slug,
        });
      }

      if (!isPreviewEligible(episode)) {
        return reply.status(200).send({ state: "invalid" });
      }

      const hasAudio = Boolean(episode.audioFinalPath);
      const enc = encodeURIComponent(token);
      const audioUrl = hasAudio
        ? `/${API_PREFIX}/public/episode-review/audio?token=${enc}`
        : null;
      const waveformUrl = hasAudio
        ? `/${API_PREFIX}/public/episode-review/waveform?token=${enc}`
        : null;

      return reply.status(200).send({
        state: "review",
        episodeUrl,
        podcastSlug: episode.podcastSlug,
        episodeSlug: episode.slug,
        episodeTitle: episode.title,
        podcastTitle: episode.podcastTitle,
        displayName: review.displayName,
        email: review.email,
        status: review.status,
        feedbackText: review.feedbackText,
        audioUrl,
        waveformUrl,
        baseUrl: origin,
      });
    },
  );

  app.post(
    "/public/episode-review/approve",
    {
      schema: {
        tags: ["Public"],
        summary: "Approve episode via guest review token",
        security: [],
        body: {
          type: "object",
          properties: { token: { type: "string" } },
          required: ["token"],
        },
      },
    },
    async (request, reply) => {
      const token = rawTokenFromBody(request.body);
      const resolved = resolveReviewFromRawToken(token);
      if (!resolved) {
        return reply.status(404).send({ error: "Invalid or expired review link" });
      }
      const { review, episode } = resolved;
      if (isFullyPublic(episode) || !isPreviewEligible(episode)) {
        return reply.status(410).send({ error: "Review link is no longer active" });
      }
      setReviewApproved(review.id);
      void notifyHostOfGuestReviewResponse({
        review,
        kind: "approved",
      }).catch((err) => {
        console.warn(
          "[episodeGuestReview] host approve notify failed:",
          err instanceof Error ? err.message : err,
        );
      });
      return reply.status(200).send({ ok: true, status: "approved" });
    },
  );

  app.post(
    "/public/episode-review/feedback",
    {
      schema: {
        tags: ["Public"],
        summary: "Submit feedback via guest review token",
        security: [],
        body: {
          type: "object",
          properties: {
            token: { type: "string" },
            message: { type: "string" },
          },
          required: ["token", "message"],
        },
      },
    },
    async (request, reply) => {
      const body = request.body as { token?: string; message?: string };
      const token = typeof body.token === "string" ? body.token.trim() : "";
      const message =
        typeof body.message === "string" ? body.message.trim() : "";
      if (!message || message.length > 5000) {
        return reply.status(400).send({
          error: "Feedback must be between 1 and 5000 characters",
        });
      }
      const resolved = resolveReviewFromRawToken(token);
      if (!resolved) {
        return reply.status(404).send({ error: "Invalid or expired review link" });
      }
      const { review, episode } = resolved;
      if (isFullyPublic(episode) || !isPreviewEligible(episode)) {
        return reply.status(410).send({ error: "Review link is no longer active" });
      }
      setReviewFeedback(review.id, message);
      void notifyHostOfGuestReviewResponse({
        review: { ...review, feedbackText: message, status: "feedback" },
        kind: "feedback",
        feedbackText: message,
      }).catch((err) => {
        console.warn(
          "[episodeGuestReview] host feedback notify failed:",
          err instanceof Error ? err.message : err,
        );
      });
      return reply.status(200).send({ ok: true, status: "feedback" });
    },
  );

  app.get(
    "/public/episode-review/audio",
    {
      schema: {
        tags: ["Public"],
        summary: "Stream episode audio for a valid guest review token",
        security: [],
        querystring: {
          type: "object",
          properties: { token: { type: "string" } },
          required: ["token"],
        },
      },
    },
    async (request, reply) => {
      const token = rawTokenFromQuery(request.query);
      const resolved = resolveReviewFromRawToken(token);
      if (!resolved) {
        return reply.status(404).send({ error: "Not found" });
      }
      const { episode } = resolved;
      if (!assertPreviewMediaAccess(episode)) {
        return reply.status(404).send({ error: "Not found" });
      }
      const path = episode.audioFinalPath
        ? resolveDataPath(episode.audioFinalPath)
        : "";
      if (!path || !existsSync(path)) {
        return reply.status(404).send({ error: "Audio file not found" });
      }
      const allowedBase = processedDir(episode.podcastId, episode.id);
      const safePath = assertPathUnder(path, allowedBase);
      const mime = episode.audioMime || "audio/mpeg";
      const result = await send(request.raw, basename(safePath), {
        root: dirname(safePath),
        contentType: false,
        maxAge: 3600,
        acceptRanges: true,
        cacheControl: true,
      });
      if (result.type === "error") {
        const err = result.metadata.error as Error & { status?: number };
        const errStatus = (err.status ?? 404) as 404 | 500;
        return reply.status(errStatus).send({ error: "Not found" });
      }
      reply.status(result.statusCode as 200 | 206 | 404 | 500);
      const headers = result.headers as Record<string, string>;
      for (const [key, value] of Object.entries(headers)) {
        if (value !== undefined) reply.header(key, value);
      }
      reply.header("Content-Type", mime);
      return reply.send(result.stream);
    },
  );

  app.get(
    "/public/episode-review/waveform",
    {
      schema: {
        tags: ["Public"],
        summary: "Get episode waveform for a valid guest review token",
        security: [],
        querystring: {
          type: "object",
          properties: { token: { type: "string" } },
          required: ["token"],
        },
      },
    },
    async (request, reply) => {
      const token = rawTokenFromQuery(request.query);
      const resolved = resolveReviewFromRawToken(token);
      if (!resolved) {
        return reply.status(404).send({ error: "Waveform not found" });
      }
      const { episode } = resolved;
      if (!assertPreviewMediaAccess(episode) || !episode.audioFinalPath) {
        return reply.status(404).send({ error: "Waveform not found" });
      }
      const audioPath = resolveDataPath(episode.audioFinalPath);
      if (!audioPath || !existsSync(audioPath)) {
        return reply.status(404).send({ error: "Waveform not found" });
      }
      const waveformPath = audioPath.replace(/\.[^.]+$/, WAVEFORM_EXTENSION);
      if (!existsSync(waveformPath)) {
        return reply.status(404).send({ error: "Waveform not found" });
      }
      try {
        assertPathUnder(waveformPath, processedDir(episode.podcastId, episode.id));
      } catch {
        return reply.status(404).send({ error: "Waveform not found" });
      }
      const json = readFileSync(waveformPath, "utf-8");
      return reply
        .header("Content-Type", "application/json")
        .header("Cache-Control", "private, max-age=3600")
        .send(json);
    },
  );
}
