import type { FastifyInstance } from "fastify";
import { requireAuth } from "../../plugins/auth.js";
import { db } from "../../db/index.js";
import {
  CSRF_COOKIE_NAME,
  JWT_COOKIE_NAME,
  MAX_API_KEYS_PER_USER,
} from "../../config.js";

export async function registerSessionRoutes(app: FastifyInstance) {
  app.post(
    "/auth/logout",
    {
      schema: {
        tags: ["Auth"],
        summary: "Logout",
        description: "Clear session cookies. No authentication required.",
        security: [],
        response: {
          200: {
            description: "OK",
            type: "object",
            properties: { ok: { type: "boolean" } },
          },
        },
      },
    },
    async (_request, reply) => {
      return reply
        .clearCookie(JWT_COOKIE_NAME, { path: "/" })
        .clearCookie(CSRF_COOKIE_NAME, { path: "/" })
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
      const user = db
        .prepare(
          `SELECT id, email, created_at, role, COALESCE(read_only, 0) AS read_only,
        max_podcasts, max_episodes, max_storage_mb, max_collaborators, max_subscriber_tokens, COALESCE(disk_bytes_used, 0) AS disk_bytes_used,
        COALESCE(can_transcribe, 0) AS can_transcribe,
        last_login_at, last_login_ip, last_login_location
       FROM users WHERE id = ?`,
        )
        .get(request.userId) as
        | {
            id: string;
            email: string;
            created_at: string;
            role: string;
            read_only: number;
            max_podcasts: number | null;
            max_episodes: number | null;
            max_storage_mb: number | null;
            max_collaborators: number | null;
            max_subscriber_tokens: number | null;
            disk_bytes_used: number;
            can_transcribe: number;
            last_login_at: string | null;
            last_login_ip: string | null;
            last_login_location: string | null;
          }
        | undefined;
      if (!user) {
        return reply.status(404).send({ error: "User not found" });
      }
      const ownedPodcasts = db
        .prepare(
          "SELECT COUNT(*) as count FROM podcasts WHERE owner_user_id = ?",
        )
        .get(request.userId) as { count: number };
      const sharedPodcasts = db
        .prepare(
          "SELECT COUNT(*) as count FROM podcast_shares WHERE user_id = ?",
        )
        .get(request.userId) as { count: number };
      const podcastCount = ownedPodcasts.count + sharedPodcasts.count;
      const episodeCount = db
        .prepare(
          `SELECT COUNT(*) as count FROM episodes e
         JOIN podcasts p ON p.id = e.podcast_id
         WHERE p.owner_user_id = ? OR EXISTS (SELECT 1 FROM podcast_shares WHERE podcast_id = p.id AND user_id = ?)`,
        )
        .get(request.userId, request.userId) as { count: number };
      const isReadOnly = user.read_only === 1;
      const twoFactorRow = db
        .prepare(
          "SELECT two_factor_method, totp_secret_enc FROM users WHERE id = ?",
        )
        .get(request.userId) as {
          two_factor_method: string | null;
          totp_secret_enc: string | null;
        } | undefined;
      const twoFactorMethod = twoFactorRow?.two_factor_method?.trim() ?? null;
      const hasTOTP = Boolean(twoFactorRow?.totp_secret_enc);
      const hasEmail = twoFactorMethod?.includes("email") ?? false;
      return {
        id: user.id,
        twoFactor: twoFactorMethod
          ? { hasTOTP, hasEmail, methods: twoFactorMethod }
          : null,
        user: {
          id: user.id,
          email: user.email,
          created_at: user.created_at,
          role: user.role,
          read_only: user.read_only ? 1 : 0,
          max_podcasts: user.max_podcasts ?? null,
          max_episodes: user.max_episodes ?? null,
          max_storage_mb: user.max_storage_mb ?? null,
          max_collaborators: user.max_collaborators ?? null,
          max_subscriber_tokens: user.max_subscriber_tokens ?? null,
          max_api_keys: MAX_API_KEYS_PER_USER,
          disk_bytes_used: user.disk_bytes_used ?? 0,
          can_transcribe: user.can_transcribe ? 1 : 0,
          last_login_at: isReadOnly ? null : (user.last_login_at ?? null),
          last_login_ip: isReadOnly ? null : (user.last_login_ip ?? null),
          last_login_location: isReadOnly
            ? null
            : (user.last_login_location ?? null),
        },
        podcast_count: podcastCount,
        episode_count: episodeCount.count,
      };
    },
  );
}
