import type { FastifyInstance } from "fastify";
import { and, eq, exists, or, sql } from "drizzle-orm";
import { requireAuth, requireAuthAllowDisabled } from "../../plugins/auth.js";
import { drizzleDb } from "../../db/index.js";
import {
  episodes,
  podcasts,
  podcastShares,
  users,
} from "../../db/schema.js";
import {
  CSRF_COOKIE_NAME,
  JWT_COOKIE_NAME,
  MAX_API_KEYS_PER_USER,
  TWOFA_CHALLENGE_COOKIE_NAME,
} from "../../config.js";

export async function registerSessionRoutes(app: FastifyInstance) {
  app.post(
    "/auth/logout",
    {
      preHandler: [requireAuthAllowDisabled],
      schema: {
        tags: ["Auth"],
        summary: "Logout",
        description:
          "Clear session cookies. Requires authentication and CSRF token to prevent cross-site logout attacks.",
        security: [],
        response: {
          200: {
            description: "OK",
            type: "object",
            properties: { ok: { type: "boolean" } },
          },
          401: { description: "Unauthorized" },
        },
      },
    },
    async (_request, reply) => {
      return reply
        .clearCookie(JWT_COOKIE_NAME, { path: "/" })
        .clearCookie(CSRF_COOKIE_NAME, { path: "/" })
        .clearCookie(TWOFA_CHALLENGE_COOKIE_NAME, { path: "/" })
        .send({ ok: true });
    },
  );

  app.get(
    "/auth/me",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Auth"],
        summary: "Get current user",
        description:
          "Returns the authenticated user profile, limits, and podcast/episode counts. Requires API key or session.",
        response: {
          200: { description: "User and counts" },
          401: { description: "Unauthorized" },
          404: { description: "User not found" },
        },
      },
    },
    async (request, reply) => {
      const user = drizzleDb
        .select({
          id: users.id,
          email: users.email,
          username: users.username,
          hasPassword: sql<number>`(password_hash IS NOT NULL AND TRIM(password_hash) != '')`.as(
            "hasPassword",
          ),
          emailVerified: sql<number>`COALESCE(${users.emailVerified}, 1)`.as(
            "emailVerified",
          ),
          createdAt: users.createdAt,
          role: users.role,
          readOnly: sql<number>`COALESCE(${users.readOnly}, 0)`.as("readOnly"),
          maxPodcasts: users.maxPodcasts,
          maxEpisodes: users.maxEpisodes,
          maxStorageMb: users.maxStorageMb,
          maxCollaborators: users.maxCollaborators,
          maxSubscriberTokens: users.maxSubscriberTokens,
          diskBytesUsed: sql<number>`COALESCE(${users.diskBytesUsed}, 0)`.as(
            "diskBytesUsed",
          ),
          canTranscribe: sql<number>`COALESCE(${users.canTranscribe}, 0)`.as(
            "canTranscribe",
          ),
          canGenerateVideo: sql<number>`COALESCE(${users.canGenerateVideo}, 0)`.as(
            "canGenerateVideo",
          ),
          canStripe: sql<number>`COALESCE(${users.canStripe}, 0)`.as("canStripe"),
          canEpisodeAlert: sql<number>`COALESCE(${users.canEpisodeAlert}, 0)`.as(
            "canEpisodeAlert",
          ),
          canUploadEpisodeFiles: sql<number>`COALESCE(${users.canUploadEpisodeFiles}, 0)`.as(
            "canUploadEpisodeFiles",
          ),
          canImportTheme: sql<number>`COALESCE(${users.canImportTheme}, 0)`.as(
            "canImportTheme",
          ),
          lastLoginAt: users.lastLoginAt,
          lastLoginIp: users.lastLoginIp,
          lastLoginLocation: users.lastLoginLocation,
        })
        .from(users)
        .where(eq(users.id, request.userId))
        .limit(1)
        .get();
      if (!user) {
        return reply.status(404).send({ error: "User not found" });
      }
      const ownedPodcasts = drizzleDb
        .select({ count: sql<number>`count(*)`.as("count") })
        .from(podcasts)
        .where(eq(podcasts.ownerUserId, request.userId))
        .get();
      const sharedPodcasts = drizzleDb
        .select({ count: sql<number>`count(*)`.as("count") })
        .from(podcastShares)
        .where(eq(podcastShares.userId, request.userId))
        .get();
      const podcastCount = (ownedPodcasts?.count ?? 0) + (sharedPodcasts?.count ?? 0);
      const episodeCount = drizzleDb
        .select({ count: sql<number>`count(*)`.as("count") })
        .from(episodes)
        .innerJoin(podcasts, eq(podcasts.id, episodes.podcastId))
        .where(
          or(
            eq(podcasts.ownerUserId, request.userId),
            exists(
              drizzleDb
                .select()
                .from(podcastShares)
                .where(
                  and(
                    eq(podcastShares.podcastId, podcasts.id),
                    eq(podcastShares.userId, request.userId),
                  ),
                ),
            ),
          ),
        )
        .get();
      const isReadOnly = user.readOnly === 1;
      const twoFactorRow = drizzleDb
        .select({
          twoFactorMethod: users.twoFactorMethod,
          totpSecretEnc: users.totpSecretEnc,
        })
        .from(users)
        .where(eq(users.id, request.userId))
        .limit(1)
        .get();
      const twoFactorMethod = twoFactorRow?.twoFactorMethod?.trim() ?? null;
      const hasTOTP = Boolean(twoFactorRow?.totpSecretEnc);
      const hasEmail = twoFactorMethod?.includes("email") ?? false;
      const hasVerifiedEmail =
        Boolean(user.email?.trim()) && user.emailVerified === 1;
      const hasUsername = Boolean(user.username?.trim());
      const needsCompleteAccount = !hasVerifiedEmail && !hasUsername;
      const hasPassword = Boolean(user.hasPassword);

      return {
        id: user.id,
        needsCompleteAccount,
        twoFactor: twoFactorMethod
          ? { hasTOTP, hasEmail, methods: twoFactorMethod }
          : null,
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          hasPassword,
          createdAt: user.createdAt,
          role: user.role,
          readOnly: user.readOnly ? 1 : 0,
          maxPodcasts: user.maxPodcasts ?? null,
          maxEpisodes: user.maxEpisodes ?? null,
          maxStorageMb: user.maxStorageMb ?? null,
          maxCollaborators: user.maxCollaborators ?? null,
          maxSubscriberTokens: user.maxSubscriberTokens ?? null,
          maxApiKeys: MAX_API_KEYS_PER_USER,
          diskBytesUsed: user.diskBytesUsed ?? 0,
          canTranscribe: user.canTranscribe ? 1 : 0,
          canGenerateVideo: user.canGenerateVideo ? 1 : 0,
          canStripe: user.canStripe ? 1 : 0,
          canEpisodeAlert: user.canEpisodeAlert ? 1 : 0,
          canUploadEpisodeFiles: user.canUploadEpisodeFiles ? 1 : 0,
          canImportTheme: user.canImportTheme ? 1 : 0,
          lastLoginAt: isReadOnly ? null : (user.lastLoginAt ?? null),
          lastLoginIp: isReadOnly ? null : (user.lastLoginIp ?? null),
          lastLoginLocation: isReadOnly
            ? null
            : (user.lastLoginLocation ?? null),
        },
        podcastCount,
        episodeCount: episodeCount?.count ?? 0,
      };
    },
  );
}
