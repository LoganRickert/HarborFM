import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import send from "@fastify/send";
import { existsSync, readFileSync } from "fs";
import { basename, dirname, extname } from "path";
import {
  assertPathUnder,
  artworkDir,
  chaptersJsonPath,
  processedDir,
  resolveDataPath,
  transcriptSrtPath,
} from "../../services/paths.js";
import { getClientIp, getUserAgent, getIpBan, recordFailureAndMaybeBan } from "../../services/loginAttempts.js";
import {
  validateSubscriberTokenByValueWithExistence,
  touchSubscriberToken,
} from "../../services/subscriberTokens.js";
import {
  getOrCreateTokenFeedTemplate,
  SUBSCRIBER_TOKEN_ID_PLACEHOLDER,
} from "../../services/rss.js";
import { EXT_DOT_TO_MIMETYPE } from "../../utils/artwork.js";
import { WAVEFORM_EXTENSION } from "../../config.js";
import { RSS_CACHE_MAX_AGE_MS } from "../../config.js";
import { ensurePublicFeedsEnabled, ARTWORK_FILENAME_REGEX } from "./utils.js";
import { AUTH_SUBSCRIBER_TOKEN_CONTEXT } from "./utils.js";
import * as repo from "./repo.js";

function resolvePodcastAndToken(
  request: FastifyRequest,
  podcastSlug: string,
  token: string,
  reply: FastifyReply,
): { podcastId: string } | null {
  const podcastId = repo.getPodcastIdBySlug(podcastSlug);
  if (!podcastId) {
    reply.status(404).send({ error: "Not found" });
    return null;
  }
  const result = validateSubscriberTokenByValueWithExistence(token);
  if (!result.tokenExists) {
    const ip = getClientIp(request);
    console.log(`[ban] Bad/unknown subscriber token attempt from IP=${ip} (resolvePodcastAndToken)`);
    const userAgent = getUserAgent(request);
    recordFailureAndMaybeBan(ip, AUTH_SUBSCRIBER_TOKEN_CONTEXT, { userAgent });
    const ban = getIpBan(ip, AUTH_SUBSCRIBER_TOKEN_CONTEXT);
    if (ban.banned) {
      reply
        .status(429)
        .header("Retry-After", String(ban.retryAfterSec))
        .send({ error: "Too many failed attempts. Try again later." });
      return null;
    }
    reply.status(404).send({ error: "Not found" });
    return null;
  }
  if (!result.row || result.row.podcastId !== podcastId) {
    reply.status(404).send({ error: "Not found" });
    return null;
  }
  touchSubscriberToken(result.row.id);
  return { podcastId };
}

export async function registerPrivateRoutes(app: FastifyInstance) {
  app.get(
    "/public/podcasts/:podcastSlug/private/:token/artwork/:filename",
    {
      schema: {
        tags: ["Public"],
        summary: "Get podcast artwork (token)",
        description:
          "Returns podcast cover image when valid subscriber token provided. 404 if invalid.",
        security: [],
        params: {
          type: "object",
          properties: {
            podcastSlug: { type: "string" },
            token: { type: "string" },
            filename: { type: "string" },
          },
          required: ["podcastSlug", "token", "filename"],
        },
        response: {
          200: { description: "Image" },
          206: { description: "Partial content" },
          404: { description: "Not found" },
          416: { description: "Range not satisfiable" },
        },
      },
    },
    async (request, reply) => {
      if (!ensurePublicFeedsEnabled(reply)) return;
      const { podcastSlug, token, filename } = request.params as {
        podcastSlug: string;
        token: string;
        filename: string;
      };
      const resolved = resolvePodcastAndToken(request, podcastSlug, token, reply);
      if (!resolved) return;
      const { podcastId } = resolved;
      if (!ARTWORK_FILENAME_REGEX.test(filename))
        return reply.status(404).send({ error: "Not found" });
      const artworkPath = repo.getPodcastArtworkPath(podcastId);
      if (!artworkPath || basename(artworkPath) !== filename)
        return reply.status(404).send({ error: "Not found" });
      try {
        const fullPath = resolveDataPath(artworkPath);
        const safePath = assertPathUnder(fullPath, artworkDir(podcastId));
        const ext = extname(safePath).toLowerCase();
        const contentType = EXT_DOT_TO_MIMETYPE[ext] ?? "image/jpeg";
        const result = await send(request.raw, basename(safePath), {
          root: dirname(safePath),
          contentType: false,
          acceptRanges: true,
          cacheControl: true,
          maxAge: 86400,
        });
        if (result.type === "error")
          return reply.status(404).send({ error: "Not found" });
        reply.status(result.statusCode as 200 | 206 | 416);
        (
          Object.entries(result.headers as Record<string, string>) as [string, string][]
        ).forEach(([k, v]) => v !== undefined && reply.header(k, v));
        reply.header("Content-Type", contentType);
        return reply.send(result.stream);
      } catch {
        return reply.status(404).send({ error: "Not found" });
      }
    },
  );

  app.get(
    "/public/podcasts/:podcastSlug/private/:token/artwork/episodes/:episodeId/:filename",
    {
      schema: {
        tags: ["Public"],
        summary: "Get episode artwork (token)",
        description:
          "Returns episode cover image when valid subscriber token provided. 404 if invalid.",
        security: [],
        params: {
          type: "object",
          properties: {
            podcastSlug: { type: "string" },
            token: { type: "string" },
            episodeId: { type: "string" },
            filename: { type: "string" },
          },
          required: ["podcastSlug", "token", "episodeId", "filename"],
        },
        response: {
          200: { description: "Image" },
          206: { description: "Partial content" },
          404: { description: "Not found" },
          416: { description: "Range not satisfiable" },
        },
      },
    },
    async (request, reply) => {
      if (!ensurePublicFeedsEnabled(reply)) return;
      const { podcastSlug, token, episodeId, filename } = request.params as {
        podcastSlug: string;
        token: string;
        episodeId: string;
        filename: string;
      };
      const resolved = resolvePodcastAndToken(request, podcastSlug, token, reply);
      if (!resolved) return;
      const { podcastId } = resolved;
      if (!ARTWORK_FILENAME_REGEX.test(filename))
        return reply.status(404).send({ error: "Not found" });
      const artworkPath = repo.getEpisodeArtworkPath(episodeId, podcastId);
      if (!artworkPath || basename(artworkPath) !== filename)
        return reply.status(404).send({ error: "Not found" });
      const tokenEpisodeArtworkPathResolved = resolveDataPath(artworkPath);
      try {
        const safePath = assertPathUnder(
          tokenEpisodeArtworkPathResolved,
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
        if (result.type === "error")
          return reply.status(404).send({ error: "Not found" });
        reply.status(result.statusCode as 200 | 206 | 416);
        (
          Object.entries(result.headers as Record<string, string>) as [string, string][]
        ).forEach(([k, v]) => v !== undefined && reply.header(k, v));
        reply.header("Content-Type", contentType);
        return reply.send(result.stream);
      } catch {
        return reply.status(404).send({ error: "Not found" });
      }
    },
  );

  app.get(
    "/public/podcasts/:podcastSlug/private/:token/episodes/:episodeIdOrSlug/transcript.srt",
    {
      schema: {
        tags: ["Public"],
        summary: "Get episode transcript (token)",
        description:
          "Returns transcript SRT when valid subscriber token provided. 404 if invalid.",
        security: [],
        params: {
          type: "object",
          properties: {
            podcastSlug: { type: "string" },
            token: { type: "string" },
            episodeIdOrSlug: { type: "string" },
          },
          required: ["podcastSlug", "token", "episodeIdOrSlug"],
        },
        response: {
          200: { description: "SRT" },
          404: { description: "Not found" },
        },
      },
    },
    async (request, reply) => {
      if (!ensurePublicFeedsEnabled(reply)) return;
      const { podcastSlug, token, episodeIdOrSlug } = request.params as {
        podcastSlug: string;
        token: string;
        episodeIdOrSlug: string;
      };
      const resolved = resolvePodcastAndToken(request, podcastSlug, token, reply);
      if (!resolved) return;
      const { podcastId } = resolved;
      const row = repo.getPublishedEpisodeByIdOrSlug(podcastId, episodeIdOrSlug);
      if (!row) return reply.status(404).send({ error: "Not found" });
      const srtPath = transcriptSrtPath(podcastId, row.id);
      if (!existsSync(srtPath))
        return reply.status(404).send({ error: "Not found" });
      try {
        assertPathUnder(srtPath, processedDir(podcastId, row.id));
      } catch {
        return reply.status(404).send({ error: "Not found" });
      }
      const body = readFileSync(srtPath) as Buffer;
      return reply
        .header("Content-Type", "application/srt; charset=utf-8")
        .header("Cache-Control", "public, max-age=3600")
        .header("Content-Length", String(body.length))
        .send(body);
    },
  );

  app.get(
    "/public/podcasts/:podcastSlug/private/:token/episodes/:episodeIdOrSlug/chapters.json",
    {
      schema: {
        tags: ["Public"],
        summary: "Get episode chapters (token)",
        description:
          "Returns chapters JSON when valid subscriber token provided. 404 if invalid.",
        security: [],
        params: {
          type: "object",
          properties: {
            podcastSlug: { type: "string" },
            token: { type: "string" },
            episodeIdOrSlug: { type: "string" },
          },
          required: ["podcastSlug", "token", "episodeIdOrSlug"],
        },
        response: {
          200: { description: "Chapters JSON" },
          404: { description: "Not found" },
        },
      },
    },
    async (request, reply) => {
      if (!ensurePublicFeedsEnabled(reply)) return;
      const { podcastSlug, token, episodeIdOrSlug } = request.params as {
        podcastSlug: string;
        token: string;
        episodeIdOrSlug: string;
      };
      const resolved = resolvePodcastAndToken(request, podcastSlug, token, reply);
      if (!resolved) return;
      const { podcastId } = resolved;
      const row = repo.getPublishedEpisodeByIdOrSlug(podcastId, episodeIdOrSlug);
      if (!row) return reply.status(404).send({ error: "Not found" });
      const path = chaptersJsonPath(podcastId, row.id);
      if (!existsSync(path))
        return reply.status(404).send({ error: "Not found" });
      try {
        assertPathUnder(path, processedDir(podcastId, row.id));
      } catch {
        return reply.status(404).send({ error: "Not found" });
      }
      const body = readFileSync(path) as Buffer;
      return reply
        .header("Content-Type", "application/json+chapters; charset=utf-8")
        .header("Cache-Control", "public, max-age=3600")
        .header("Content-Length", String(body.length))
        .send(body);
    },
  );

  app.get(
    "/public/podcasts/:podcastSlug/private/:token/episodes/:episodeSlug/waveform",
    {
      schema: {
        tags: ["Public"],
        summary: "Get episode waveform (token)",
        description:
          "Returns waveform JSON when valid subscriber token provided. 404 if invalid.",
        security: [],
        params: {
          type: "object",
          properties: {
            podcastSlug: { type: "string" },
            token: { type: "string" },
            episodeSlug: { type: "string" },
          },
          required: ["podcastSlug", "token", "episodeSlug"],
        },
        response: {
          200: { description: "Waveform JSON" },
          404: { description: "Not found" },
        },
      },
    },
    async (request, reply) => {
      if (!ensurePublicFeedsEnabled(reply)) return;
      const { podcastSlug, token, episodeSlug } = request.params as {
        podcastSlug: string;
        token: string;
        episodeSlug: string;
      };
      const resolved = resolvePodcastAndToken(request, podcastSlug, token, reply);
      if (!resolved) return;
      const { podcastId } = resolved;
      const row = repo.getEpisodeForWaveform(podcastId, episodeSlug);
      if (!row || !row.audioFinalPath) {
        return reply.status(404).send({ error: "Waveform not found" });
      }
      const audioPath = resolveDataPath(row.audioFinalPath);
      if (!audioPath || !existsSync(audioPath)) {
        return reply.status(404).send({ error: "Waveform not found" });
      }
      const waveformPath = audioPath.replace(/\.[^.]+$/, WAVEFORM_EXTENSION);
      if (!existsSync(waveformPath)) {
        return reply.status(404).send({ error: "Waveform not found" });
      }
      try {
        assertPathUnder(waveformPath, processedDir(podcastId, row.id));
      } catch {
        return reply.status(404).send({ error: "Waveform not found" });
      }
      const json = readFileSync(waveformPath, "utf-8");
      return reply
        .header("Content-Type", "application/json")
        .header("Cache-Control", "public, max-age=3600")
        .send(json);
    },
  );

  app.get(
    "/public/podcasts/:podcastSlug/private/:token/episodes/:episodeId",
    {
      schema: {
        tags: ["Public"],
        summary: "Stream episode audio (token)",
        description:
          "Returns episode audio when valid subscriber token provided. 404 if invalid. Supports Range.",
        security: [],
        params: {
          type: "object",
          properties: {
            podcastSlug: { type: "string" },
            token: { type: "string" },
            episodeId: { type: "string" },
          },
          required: ["podcastSlug", "token", "episodeId"],
        },
        response: {
          200: { description: "Audio" },
          206: { description: "Partial" },
          404: { description: "Not found" },
          500: { description: "Server error" },
        },
      },
    },
    async (request, reply) => {
      if (!ensurePublicFeedsEnabled(reply)) return;
      const {
        podcastSlug,
        token,
        episodeId: rawEpisodeId,
      } = request.params as {
        podcastSlug: string;
        token: string;
        episodeId: string;
      };
      const episodeId = rawEpisodeId.replace(/\.[a-zA-Z0-9]+$/, "") || rawEpisodeId;
      const resolved = resolvePodcastAndToken(request, podcastSlug, token, reply);
      if (!resolved) return;
      const { podcastId } = resolved;
      const episode = repo.getEpisodeAudioForPrivate(podcastId, episodeId);
      const audioPath = episode?.audioFinalPath
        ? resolveDataPath(episode.audioFinalPath)
        : "";
      if (!episode?.audioFinalPath || !audioPath || !existsSync(audioPath))
        return reply.status(404).send({ error: "Not found" });
      try {
        const safePath = assertPathUnder(
          audioPath,
          processedDir(podcastId, episodeId),
        );
        const mime = (episode.audioMime as string) || "audio/mpeg";
        const result = await send(request.raw, basename(safePath), {
          root: dirname(safePath),
          contentType: false,
          maxAge: 3600,
          acceptRanges: true,
          cacheControl: true,
        });
        if (result.type === "error")
          return reply.status(404).send({ error: "Not found" });
        reply.status(result.statusCode as 200 | 206 | 404 | 500);
        (
          Object.entries(result.headers as Record<string, string>) as [string, string][]
        ).forEach(([k, v]) => v !== undefined && reply.header(k, v));
        reply.header("Content-Type", mime);
        return reply.send(result.stream);
      } catch {
        return reply.status(404).send({ error: "Not found" });
      }
    },
  );

  app.get(
    "/public/podcasts/:podcastSlug/private/:token/rss",
    {
      schema: {
        tags: ["Public"],
        summary: "Get private RSS feed",
        description:
          "Returns the RSS feed XML for a podcast when valid subscriber token is provided in the path. 404 if token invalid or expired.",
        security: [],
        params: {
          type: "object",
          properties: {
            podcastSlug: { type: "string" },
            token: { type: "string" },
          },
          required: ["podcastSlug", "token"],
        },
        response: {
          200: { description: "RSS XML" },
          404: { description: "Not found" },
          429: { description: "Too many failed attempts (banned)" },
          500: { description: "Failed to generate feed" },
        },
      },
    },
    async (request, reply) => {
      if (!ensurePublicFeedsEnabled(reply)) return;
      const { podcastSlug, token } = request.params as {
        podcastSlug: string;
        token: string;
      };
      const podcastId = repo.getPodcastIdBySlug(podcastSlug);
      if (!podcastId) return reply.status(404).send({ error: "Not found" });
      const result = validateSubscriberTokenByValueWithExistence(token);
      if (!result.tokenExists) {
        const ip = getClientIp(request);
        console.log(`[ban] Bad/unknown subscriber token attempt from IP=${ip} (GET private rss)`);
        const userAgent = getUserAgent(request);
        recordFailureAndMaybeBan(ip, AUTH_SUBSCRIBER_TOKEN_CONTEXT, { userAgent });
        const ban = getIpBan(ip, AUTH_SUBSCRIBER_TOKEN_CONTEXT);
        if (ban.banned) {
          return reply
            .status(429)
            .header("Retry-After", String(ban.retryAfterSec))
            .send({ error: "Too many failed attempts. Try again later." });
        }
        return reply.status(404).send({ error: "Not found" });
      }
      if (!result.row || result.row.podcastId !== podcastId)
        return reply.status(404).send({ error: "Not found" });
      try {
        const template = getOrCreateTokenFeedTemplate(podcastId, RSS_CACHE_MAX_AGE_MS);
        const xml = template.replaceAll(SUBSCRIBER_TOKEN_ID_PLACEHOLDER, token);
        touchSubscriberToken(result.row.id);
        return reply
          .header("Content-Type", "application/xml; charset=utf-8")
          .header("Cache-Control", "public, max-age=3600")
          .send(xml);
      } catch (_err) {
        return reply.status(500).send({ error: "Failed to generate feed" });
      }
    },
  );
}
