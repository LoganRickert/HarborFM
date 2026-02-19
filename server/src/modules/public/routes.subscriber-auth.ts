import type { FastifyInstance } from "fastify";
import {
  getClientIp,
  getUserAgent,
  getIpBan,
  recordFailureAndMaybeBan,
} from "../../services/loginAttempts.js";
import {
  validateSubscriberTokenByValue,
  validateSubscriberTokenByValueWithExistence,
  touchSubscriberToken,
} from "../../services/subscriberTokens.js";
import {
  ensurePublicFeedsEnabled,
  SUBSCRIBER_TOKENS_COOKIE,
  COOKIE_MAX_AGE,
  AUTH_SUBSCRIBER_TOKEN_CONTEXT,
  getSubscriberCookieSecure,
} from "./utils.js";
import * as repo from "./repo.js";

export async function registerSubscriberAuthRoutes(app: FastifyInstance) {
  app.post(
    "/public/subscriber-auth",
    {
      schema: {
        tags: ["Public"],
        summary: "Authenticate subscriber",
        description:
          "Validates subscriber token and sets httpOnly cookie. Returns error if invalid.",
        security: [],
        body: {
          type: "object",
          properties: {
            token: { type: "string" },
            podcastSlug: { type: "string" },
          },
          required: ["token", "podcastSlug"],
        },
        response: {
          200: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              podcastSlug: { type: "string" },
            },
          },
          400: { description: "Invalid request" },
          404: { description: "Invalid token" },
          429: { description: "Too many failed attempts (banned)" },
        },
      },
    },
    async (request, reply) => {
      if (!ensurePublicFeedsEnabled(reply)) return;
      const { token, podcastSlug } = request.body as {
        token: string;
        podcastSlug: string;
      };

      if (!token?.trim() || !podcastSlug?.trim()) {
        return reply
          .status(400)
          .send({ error: "Token and podcastSlug are required" });
      }

      const podcastId = repo.getPodcastIdBySlug(podcastSlug.trim());
      if (!podcastId) {
        return reply.status(404).send({ error: "Podcast not found" });
      }

      const tokenResult = validateSubscriberTokenByValueWithExistence(
        token.trim(),
      );
      if (!tokenResult.tokenExists) {
        const ip = getClientIp(request);
        console.log(`[ban] Bad/unknown subscriber token attempt from IP=${ip} (POST subscriber-auth)`);
        const userAgent = getUserAgent(request);
        recordFailureAndMaybeBan(ip, AUTH_SUBSCRIBER_TOKEN_CONTEXT, {
          userAgent,
        });
        const ban = getIpBan(ip, AUTH_SUBSCRIBER_TOKEN_CONTEXT);
        if (ban.banned) {
          return reply
            .status(429)
            .header("Retry-After", String(ban.retryAfterSec))
            .send({ error: "Too many failed attempts. Try again later." });
        }
        return reply.status(404).send({ error: "Invalid or expired token" });
      }
      if (!tokenResult.row || tokenResult.row.podcastId !== podcastId) {
        return reply.status(404).send({ error: "Invalid or expired token" });
      }
      const tokenRow = tokenResult.row;

      const existingCookie = request.cookies[SUBSCRIBER_TOKENS_COOKIE];
      let tokenMap: Record<string, string> = {};
      if (existingCookie) {
        try {
          tokenMap = JSON.parse(existingCookie);
          if (typeof tokenMap !== "object" || Array.isArray(tokenMap)) {
            tokenMap = {};
          }
        } catch {
          tokenMap = {};
        }
      }

      tokenMap[podcastSlug.trim()] = token.trim();

      reply.setCookie(SUBSCRIBER_TOKENS_COOKIE, JSON.stringify(tokenMap), {
        httpOnly: true,
        secure: getSubscriberCookieSecure(),
        sameSite: "lax",
        path: "/",
        maxAge: COOKIE_MAX_AGE,
      });

      touchSubscriberToken(tokenRow.id);
      return { success: true, podcastSlug: podcastSlug.trim() };
    },
  );

  app.get(
    "/public/subscriber-auth/status",
    {
      schema: {
        tags: ["Public"],
        summary: "Get authentication status",
        description:
          "Returns list of authenticated podcast slugs and tokens (for building private URLs). Cleans up invalid tokens.",
        security: [],
        response: {
          200: {
            type: "object",
            properties: {
              authenticated: { type: "boolean" },
              podcastSlugs: { type: "array", items: { type: "string" } },
              tokens: {
                type: "object",
                additionalProperties: { type: "string" },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      if (!ensurePublicFeedsEnabled(reply)) return;

      const existingCookie = request.cookies[SUBSCRIBER_TOKENS_COOKIE];
      if (!existingCookie) {
        return { authenticated: false, podcastSlugs: [] };
      }

      let tokenMap: Record<string, string> = {};
      try {
        tokenMap = JSON.parse(existingCookie);
        if (typeof tokenMap !== "object" || Array.isArray(tokenMap)) {
          tokenMap = {};
        }
      } catch {
        tokenMap = {};
      }

      const validPodcastSlugs: string[] = [];
      const cleanedTokenMap: Record<string, string> = {};

      for (const [slug, token] of Object.entries(tokenMap)) {
        const podcastId = repo.getPodcastIdBySlug(slug);
        if (podcastId) {
          const tokenRow = validateSubscriberTokenByValue(token);
          if (tokenRow && tokenRow.podcastId === podcastId) {
            validPodcastSlugs.push(slug);
            cleanedTokenMap[slug] = token;
          }
        }
      }

      if (Object.keys(cleanedTokenMap).length > 0) {
        reply.setCookie(
          SUBSCRIBER_TOKENS_COOKIE,
          JSON.stringify(cleanedTokenMap),
          {
            httpOnly: true,
            secure: getSubscriberCookieSecure(),
            sameSite: "lax",
            path: "/",
            maxAge: COOKIE_MAX_AGE,
          },
        );
      } else {
        reply.clearCookie(SUBSCRIBER_TOKENS_COOKIE, { path: "/" });
      }

      return {
        authenticated: validPodcastSlugs.length > 0,
        podcastSlugs: validPodcastSlugs,
        tokens: cleanedTokenMap,
      };
    },
  );

  app.delete(
    "/public/subscriber-auth",
    {
      schema: {
        tags: ["Public"],
        summary: "Logout subscriber",
        description:
          "Clears subscriber token cookie. Optional podcastSlug query param to remove specific podcast only.",
        security: [],
        querystring: {
          type: "object",
          properties: { podcastSlug: { type: "string" } },
        },
        response: {
          200: { type: "object", properties: { success: { type: "boolean" } } },
        },
      },
    },
    async (request, reply) => {
      if (!ensurePublicFeedsEnabled(reply)) return;

      const { podcastSlug } = request.query as { podcastSlug?: string };

      if (podcastSlug?.trim()) {
        const existingCookie = request.cookies[SUBSCRIBER_TOKENS_COOKIE];
        if (existingCookie) {
          try {
            const tokenMap = JSON.parse(existingCookie);
            if (typeof tokenMap === "object" && !Array.isArray(tokenMap)) {
              delete tokenMap[podcastSlug.trim()];

              if (Object.keys(tokenMap).length > 0) {
                reply.setCookie(
                  SUBSCRIBER_TOKENS_COOKIE,
                  JSON.stringify(tokenMap),
                  {
                    httpOnly: true,
                    secure: getSubscriberCookieSecure(),
                    sameSite: "lax",
                    path: "/",
                    maxAge: COOKIE_MAX_AGE,
                  },
                );
              } else {
                reply.clearCookie(SUBSCRIBER_TOKENS_COOKIE, { path: "/" });
              }
            }
          } catch {
            reply.clearCookie(SUBSCRIBER_TOKENS_COOKIE, { path: "/" });
          }
        }
      } else {
        reply.clearCookie(SUBSCRIBER_TOKENS_COOKIE, { path: "/" });
      }

      return { success: true };
    },
  );
}
