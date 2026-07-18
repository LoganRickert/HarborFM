import type { FastifyInstance } from "fastify";
import { randomBytes } from "crypto";
import { existsSync, rmSync, statSync, unlinkSync } from "fs";
import { join } from "path";
import argon2 from "argon2";
import { nanoid } from "nanoid";
import type { UserUpdateBody } from "@harborfm/shared";
import { userCreateBodySchema, userUpdateBodySchema } from "@harborfm/shared";
import { RESET_TOKEN_EXPIRY_HOURS } from "../../config.js";
import { requireAdmin } from "../../plugins/auth.js";
import { readSettings } from "../settings/index.js";
import { sendMail, buildWelcomeSetPasswordEmail } from "../../services/email.js";
import { normalizeHostname } from "../../utils/url.js";
import { sha256Hex } from "../../utils/hash.js";
import { runPodcastDeleteSync } from "../podcasts/deleteTask.js";
import {
  assertPathUnder,
  assertResolvedPathUnder,
  getDataDir,
  libraryDir,
  resolveDataPath,
} from "../../services/paths.js";
import { toUser } from "./utils.js";
import * as repo from "./repo.js";

export async function registerCoreRoutes(app: FastifyInstance) {
  app.get(
    "/users",
    {
      preHandler: [requireAdmin],
      schema: {
        tags: ["Users"],
        summary: "List users",
        description: "Paginated list of users. Admin only.",
        querystring: {
          type: "object",
          properties: {
            page: { type: "string" },
            limit: { type: "string" },
            search: { type: "string" },
          },
        },
        response: { 200: { description: "Users and pagination" } },
      },
    },
    async (request, _reply) => {
      const query = request.query as
        | { page?: string; limit?: string; search?: string }
        | undefined;
      const page = Math.max(1, parseInt(query?.page ?? "1", 10) || 1);
      const limit = Math.min(
        100,
        Math.max(10, parseInt(query?.limit ?? "50", 10) || 50),
      );
      const offset = (page - 1) * limit;
      const search = query?.search?.trim() ?? "";

      const { rows, total } = repo.listUsers({ limit, offset, search });

      const userIds = rows.map((r) => r.id);
      const identityRows = repo.getIdentitiesByUserIds(userIds);
      const issuerToName = repo.getIssuerToNameMap();
      const normIssuer = (s: string) => (s || "").trim().replace(/\/+$/, "");
      const identitiesByUser = new Map<
        string,
        Array<{ providerType: string; issuer: string; providerName?: string }>
      >();
      for (const id of identityRows) {
        const arr = identitiesByUser.get(id.userId) ?? [];
        arr.push({
          providerType: id.providerType,
          issuer: id.issuer,
          providerName: issuerToName.get(normIssuer(id.issuer)),
        });
        identitiesByUser.set(id.userId, arr);
      }

      const usersOut = rows.map((r) => ({
        ...toUser(r),
        federatedIdentities: identitiesByUser.get(r.id) ?? [],
      }));

      return {
        users: usersOut,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    },
  );

  app.post(
    "/users",
    {
      preHandler: [requireAdmin],
      schema: {
        tags: ["Users"],
        summary: "Create user",
        description:
          "Create a new user account. Admin only. Email must be unique; password required.",
        body: {
          type: "object",
          properties: {
            email: { type: "string" },
            password: { type: "string" },
            role: { type: "string", enum: ["user", "admin"] },
          },
          required: ["email", "password"],
        },
        response: {
          201: { description: "User created" },
          400: { description: "Validation failed" },
          409: { description: "Email already registered" },
          500: { description: "Internal error" },
        },
      },
    },
    async (request, reply) => {
      const parsed = userCreateBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({
            error: parsed.error.issues[0]?.message ?? "Validation failed",
            details: parsed.error.flatten(),
          });
      }
      const { email, password, role } = parsed.data;

      if (repo.emailExists(email)) {
        return reply.code(409).send({ error: "Email already registered" });
      }

      const id = nanoid();
      const passwordHash = await argon2.hash(password);
      const settingsData = readSettings();
      const maxPodcasts =
        settingsData.default_max_podcasts == null ||
        settingsData.default_max_podcasts === 0
          ? null
          : settingsData.default_max_podcasts;
      const maxStorageMb =
        settingsData.default_storage_mb == null ||
        settingsData.default_storage_mb === 0
          ? null
          : settingsData.default_storage_mb;
      const maxEpisodes =
        settingsData.default_max_episodes == null ||
        settingsData.default_max_episodes === 0
          ? null
          : settingsData.default_max_episodes;
      const maxCollaborators =
        settingsData.default_max_collaborators == null ||
        settingsData.default_max_collaborators === 0
          ? null
          : settingsData.default_max_collaborators;
      const maxSubscriberTokens =
        settingsData.default_max_subscriber_tokens == null ||
        settingsData.default_max_subscriber_tokens === 0
          ? null
          : settingsData.default_max_subscriber_tokens;
      const canTranscribe = settingsData.default_can_transcribe ? 1 : 0;
      const canGenerateVideo = settingsData.default_can_generate_video ? 1 : 0;
      const canStripe = settingsData.default_can_stripe ? 1 : 0;
      const canEpisodeAlert = settingsData.default_can_episode_alert ? 1 : 0;
      const canUploadEpisodeFiles = settingsData.default_can_upload_episode_files
        ? 1
        : 0;

      repo.insertUser({
        id,
        email,
        passwordHash,
        role,
        maxPodcasts,
        maxStorageMb,
        maxEpisodes,
        maxCollaborators,
        maxSubscriberTokens,
        canTranscribe,
        canGenerateVideo,
        canStripe,
        canEpisodeAlert,
        canUploadEpisodeFiles,
        emailVerified: true,
      });

      if (
        (settingsData.email_provider === "smtp" ||
          settingsData.email_provider === "sendgrid" ||
          settingsData.email_provider === "webhook") &&
        settingsData.email_enable_admin_welcome
      ) {
        const token = randomBytes(32).toString("base64url");
        const tokenHash = sha256Hex(token);
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + RESET_TOKEN_EXPIRY_HOURS);
        const now = new Date().toISOString();
        repo.insertPasswordResetToken({
          email,
          tokenHash,
          expiresAt: expiresAt.toISOString(),
          createdAt: now,
        });
        const baseUrl =
          normalizeHostname(settingsData.hostname || "") || "http://localhost";
        const resetUrl = `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`;
        const { subject, text, html } = buildWelcomeSetPasswordEmail(
          resetUrl,
          baseUrl,
          RESET_TOKEN_EXPIRY_HOURS,
        );
        const sendResult = await sendMail({ to: email, subject, text, html });
        if (!sendResult.sent) {
          request.log.warn(
            { err: sendResult.error },
            "Welcome email failed to send for new user",
          );
        }
      }

      const row = repo.getUserById(id);
      if (!row) {
        return reply.code(500).send({ error: "Failed to fetch created user" });
      }
      return reply.code(201).send(toUser(row));
    },
  );

  app.patch(
    "/users/:userId",
    {
      preHandler: [requireAdmin],
      schema: {
        tags: ["Users"],
        summary: "Update user",
        description:
          "Update user fields (email, role, disabled, readOnly, password, limits). Admin only.",
        params: {
          type: "object",
          properties: { userId: { type: "string" } },
          required: ["userId"],
        },
        body: {
          type: "object",
          properties: {
            email: { type: "string" },
            username: { type: ["string", "null"] },
            role: { type: "string", enum: ["user", "admin"] },
            disabled: { type: "boolean" },
            readOnly: { type: "boolean" },
            canTranscribe: { type: "boolean" },
            canGenerateVideo: { type: "boolean" },
            canStripe: { type: "boolean" },
            canEpisodeAlert: { type: "boolean" },
            canUploadEpisodeFiles: { type: "boolean" },
            password: { type: "string" },
            maxPodcasts: {},
            maxEpisodes: {},
            maxStorageMb: {},
            maxCollaborators: {},
            maxSubscriberTokens: {},
          },
        },
        response: {
          200: { description: "Updated user" },
          400: { description: "Validation or email in use" },
          404: { description: "User not found" },
        },
      },
    },
    async (request, reply) => {
      const { userId } = request.params as { userId: string };
      const parsed = userUpdateBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({
            error: parsed.error.issues[0]?.message ?? "Validation failed",
            details: parsed.error.flatten(),
          });
      }
      const body: UserUpdateBody = parsed.data;

      const existingUser = repo.getUserById(userId);
      if (!existingUser) {
        return reply.code(404).send({ error: "User not found" });
      }

      if (body.email !== undefined) {
        if (repo.emailExistsExcludingUserId(userId, body.email)) {
          return reply.code(400).send({ error: "Email already in use" });
        }
      }

      if (body.username !== undefined) {
        const canonicalUsername =
          body.username === null ? null : body.username.toLowerCase().trim();
        if (canonicalUsername !== null) {
          if (
            repo.usernameTakenExcludingUserId(userId, canonicalUsername)
          ) {
            return reply.code(400).send({ error: "Username already taken" });
          }
        }
      }

      const set: Record<string, unknown> = {};
      if (body.email !== undefined) set.email = body.email;
      if (body.username !== undefined) set.username = body.username;
      if (body.role !== undefined) set.role = body.role;
      if (body.disabled !== undefined) set.disabled = body.disabled;
      if (body.readOnly !== undefined)
        set.readOnly = body.readOnly === true ? 1 : 0;
      if (body.canTranscribe !== undefined) set.canTranscribe = body.canTranscribe ? 1 : 0;
      if (body.canGenerateVideo !== undefined) set.canGenerateVideo = body.canGenerateVideo ? 1 : 0;
      if (body.canStripe !== undefined) set.canStripe = body.canStripe ? 1 : 0;
      if (body.canEpisodeAlert !== undefined)
        set.canEpisodeAlert = body.canEpisodeAlert ? 1 : 0;
      if (body.canUploadEpisodeFiles !== undefined)
        set.canUploadEpisodeFiles = body.canUploadEpisodeFiles ? 1 : 0;
      if (body.password !== undefined) {
        set.passwordHash = await argon2.hash(body.password);
      }
      if (body.maxPodcasts !== undefined) set.maxPodcasts = body.maxPodcasts;
      if (body.maxEpisodes !== undefined) set.maxEpisodes = body.maxEpisodes;
      if (body.maxStorageMb !== undefined) set.maxStorageMb = body.maxStorageMb;
      if (body.maxCollaborators !== undefined)
        set.maxCollaborators = body.maxCollaborators;
      if (body.maxSubscriberTokens !== undefined)
        set.maxSubscriberTokens = body.maxSubscriberTokens;

      if (Object.keys(set).length === 0) {
        return reply.code(400).send({ error: "No fields to update" });
      }

      repo.updateUser(userId, set);

      const row = repo.getUserById(userId);
      if (!row) {
        return reply.code(404).send({ error: "User not found" });
      }
      return reply.send(toUser(row));
    },
  );

  app.get(
    "/users/:userId",
    {
      preHandler: [requireAdmin],
      schema: {
        tags: ["Users"],
        summary: "Get user",
        description: "Get a user by ID. Admin only.",
        params: {
          type: "object",
          properties: { userId: { type: "string" } },
          required: ["userId"],
        },
        response: {
          200: { description: "User" },
          404: { description: "User not found" },
        },
      },
    },
    async (request, reply) => {
      const { userId } = request.params as { userId: string };
      const row = repo.getUserById(userId);
      if (!row) {
        return reply.code(404).send({ error: "User not found" });
      }
      const identityRows = repo.getIdentitiesForUser(userId);
      const issuerToName = repo.getIssuerToNameMap();
      const federatedIdentities = identityRows.map((id) => ({
        providerType: id.providerType,
        issuer: id.issuer,
        providerName: issuerToName.get(
          (id.issuer || "").trim().replace(/\/+$/, ""),
        ),
      }));
      return reply.send(toUser(row, federatedIdentities));
    },
  );

  app.delete(
    "/users/:userId",
    {
      preHandler: [requireAdmin],
      schema: {
        tags: ["Users"],
        summary: "Delete user",
        description: "Permanently delete a user. Admin only.",
        params: {
          type: "object",
          properties: { userId: { type: "string" } },
          required: ["userId"],
        },
        response: {
          200: { description: "success: true" },
          404: { description: "User not found" },
        },
      },
    },
    async (request, reply) => {
      const { userId } = request.params as { userId: string };

      const existingUser = repo.getUserById(userId);
      if (!existingUser) {
        return reply.code(404).send({ error: "User not found" });
      }

      const podcastIds = repo.getOwnedPodcastIds(userId);
      for (const podcastId of podcastIds) {
        runPodcastDeleteSync(podcastId);
      }

      const assets = repo.getReusableAssetsForUser(userId);
      const base = libraryDir(userId);
      for (const asset of assets) {
        const path = asset.audioPath ? resolveDataPath(asset.audioPath) : "";
        if (path && existsSync(path)) {
          try {
            assertPathUnder(path, base);
            const bytesFreed = statSync(path).size;
            unlinkSync(path);
            if (bytesFreed > 0) {
              repo.decrementUserDiskBytes(userId, bytesFreed);
            }
          } catch (_) {
            /* best-effort */
          }
        }
        repo.deleteReusableAsset(asset.id);
      }

      const libraryUserDir = join(getDataDir(), "library", userId);
      try {
        assertResolvedPathUnder(libraryUserDir, getDataDir());
        if (existsSync(libraryUserDir)) {
          rmSync(libraryUserDir, { recursive: true });
        }
      } catch (_) {
        /* best-effort */
      }

      repo.deleteUser(userId);

      return reply.send({ success: true });
    },
  );
}
