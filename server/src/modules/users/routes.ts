import type { FastifyInstance } from "fastify";
import { randomBytes } from "crypto";
import argon2 from "argon2";
import { nanoid } from "nanoid";
import type { UserUpdateBody } from "@harborfm/shared";
import { userCreateBodySchema, userUpdateBodySchema } from "@harborfm/shared";
import { RESET_TOKEN_EXPIRY_HOURS } from "../../config.js";
import { requireAdmin } from "../../plugins/auth.js";
import { db } from "../../db/index.js";
import { readSettings } from "../settings/index.js";
import { sendMail, buildWelcomeSetPasswordEmail } from "../../services/email.js";
import { normalizeHostname } from "../../utils/url.js";

export interface User {
  id: string;
  email: string;
  created_at: string;
  role: "user" | "admin";
  disabled: number; // SQLite uses INTEGER for booleans (0 = false, 1 = true)
  read_only: number; // 0 = false, 1 = true
  disk_bytes_used: number;
  last_login_at: string | null;
  last_login_ip: string | null;
  last_login_location: string | null;
  max_podcasts: number | null;
  max_episodes: number | null;
  max_storage_mb: number | null;
  max_collaborators: number | null;
  max_subscriber_tokens: number | null;
  can_transcribe: number;
}

export async function usersRoutes(app: FastifyInstance) {
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

      // Build WHERE clause for search
      let whereClause = "";
      let searchParam: string | undefined;
      if (search) {
        whereClause = "WHERE email LIKE ?";
        searchParam = `%${search}%`;
      }

      // Get total count with search filter
      const countQuery = search
        ? db.prepare(`SELECT COUNT(*) as count FROM users ${whereClause}`)
        : db.prepare("SELECT COUNT(*) as count FROM users");
      const totalCount = (
        search ? countQuery.get(searchParam!) : countQuery.get()
      ) as { count: number };
      const total = totalCount.count;

      // Get paginated users (oldest to newest by default)
      const queryStr = `SELECT id, email, created_at, role, COALESCE(disabled, 0) as disabled, COALESCE(read_only, 0) as read_only, COALESCE(disk_bytes_used, 0) as disk_bytes_used, last_login_at, last_login_ip, last_login_location, max_podcasts, max_episodes, max_storage_mb, max_collaborators, max_subscriber_tokens, COALESCE(can_transcribe, 0) as can_transcribe FROM users ${whereClause} ORDER BY created_at ASC LIMIT ? OFFSET ?`;
      const rows = search
        ? (db.prepare(queryStr).all(searchParam, limit, offset) as User[])
        : (db.prepare(queryStr).all(limit, offset) as User[]);

      return {
        users: rows,
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

      const existing = db
        .prepare("SELECT id FROM users WHERE email = ?")
        .get(email) as { id: string } | undefined;
      if (existing) {
        return reply.code(409).send({ error: "Email already registered" });
      }

      const id = nanoid();
      const password_hash = await argon2.hash(password);
      const settings = readSettings();
      const max_podcasts =
        settings.default_max_podcasts == null ||
        settings.default_max_podcasts === 0
          ? null
          : settings.default_max_podcasts;
      const max_storage_mb =
        settings.default_storage_mb == null || settings.default_storage_mb === 0
          ? null
          : settings.default_storage_mb;
      const max_episodes =
        settings.default_max_episodes == null ||
        settings.default_max_episodes === 0
          ? null
          : settings.default_max_episodes;
      const max_collaborators =
        settings.default_max_collaborators == null ||
        settings.default_max_collaborators === 0
          ? null
          : settings.default_max_collaborators;
      const max_subscriber_tokens =
        settings.default_max_subscriber_tokens == null ||
        settings.default_max_subscriber_tokens === 0
          ? null
          : settings.default_max_subscriber_tokens;
      const can_transcribe = settings.default_can_transcribe ? 1 : 0;

      db.prepare(
        `INSERT INTO users (id, email, password_hash, role, max_podcasts, max_storage_mb, max_episodes, max_collaborators, max_subscriber_tokens, can_transcribe, email_verified)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      ).run(
        id,
        email,
        password_hash,
        role,
        max_podcasts,
        max_storage_mb,
        max_episodes,
        max_collaborators,
        max_subscriber_tokens,
        can_transcribe,
      );

      if (
        (settings.email_provider === "smtp" ||
          settings.email_provider === "sendgrid") &&
        settings.email_enable_admin_welcome
      ) {
        const token = randomBytes(32).toString("base64url");
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + RESET_TOKEN_EXPIRY_HOURS);
        const now = new Date().toISOString();
        db.prepare(
          "INSERT INTO password_reset_tokens (email, token, expires_at, created_at) VALUES (?, ?, ?, ?)",
        ).run(email, token, expiresAt.toISOString(), now);
        const baseUrl =
          normalizeHostname(settings.hostname || "") || "http://localhost";
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

      const user = db
        .prepare(
          "SELECT id, email, created_at, role, COALESCE(disabled, 0) as disabled, COALESCE(read_only, 0) as read_only, COALESCE(disk_bytes_used, 0) as disk_bytes_used, last_login_at, last_login_ip, last_login_location, max_podcasts, max_episodes, max_storage_mb, max_collaborators, max_subscriber_tokens, COALESCE(can_transcribe, 0) as can_transcribe FROM users WHERE id = ?",
        )
        .get(id) as User;
      return reply.code(201).send(user);
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
          "Update user fields (email, role, disabled, read_only, password, limits). Admin only.",
        params: {
          type: "object",
          properties: { userId: { type: "string" } },
          required: ["userId"],
        },
        body: {
          type: "object",
          properties: {
            email: { type: "string" },
            role: { type: "string", enum: ["user", "admin"] },
            disabled: { type: "boolean" },
            read_only: { type: "boolean" },
            can_transcribe: { type: "boolean" },
            password: { type: "string" },
            max_podcasts: {},
            max_episodes: {},
            max_storage_mb: {},
            max_collaborators: {},
            max_subscriber_tokens: {},
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
      const body = parsed.data as UserUpdateBody;

      // Check if user exists
      const user = db
        .prepare("SELECT id FROM users WHERE id = ?")
        .get(userId) as { id: string } | undefined;
      if (!user) {
        return reply.code(404).send({ error: "User not found" });
      }

      // Update user fields
      const updates: string[] = [];
      const values: (string | number | null)[] = [];

      if (body.email !== undefined) {
        // Check if email is already taken by another user
        const existing = db
          .prepare("SELECT id FROM users WHERE email = ? AND id != ?")
          .get(body.email, userId) as { id: string } | undefined;
        if (existing) {
          return reply.code(400).send({ error: "Email already in use" });
        }
        updates.push("email = ?");
        values.push(body.email);
      }

      if (body.role !== undefined) {
        updates.push("role = ?");
        values.push(body.role);
      }

      if (body.disabled !== undefined) {
        updates.push("disabled = ?");
        values.push(body.disabled ? 1 : 0);
      }

      if (body.read_only !== undefined) {
        updates.push("read_only = ?");
        values.push(body.read_only ? 1 : 0);
      }

      if (body.can_transcribe !== undefined) {
        updates.push("can_transcribe = ?");
        values.push(body.can_transcribe ? 1 : 0);
      }

      if (body.password !== undefined) {
        const password_hash = await argon2.hash(body.password);
        updates.push("password_hash = ?");
        values.push(password_hash);
      }

      if (body.max_podcasts !== undefined) {
        updates.push("max_podcasts = ?");
        values.push(body.max_podcasts);
      }
      if (body.max_episodes !== undefined) {
        updates.push("max_episodes = ?");
        values.push(body.max_episodes);
      }
      if (body.max_storage_mb !== undefined) {
        updates.push("max_storage_mb = ?");
        values.push(body.max_storage_mb);
      }
      if (body.max_collaborators !== undefined) {
        updates.push("max_collaborators = ?");
        values.push(body.max_collaborators);
      }
      if (body.max_subscriber_tokens !== undefined) {
        updates.push("max_subscriber_tokens = ?");
        values.push(body.max_subscriber_tokens);
      }

      if (updates.length === 0) {
        return reply.code(400).send({ error: "No fields to update" });
      }

      values.push(userId);
      const sql = `UPDATE users SET ${updates.join(", ")} WHERE id = ?`;
      db.prepare(sql).run(...values);

      // Return updated user
      const updated = db
        .prepare(
          "SELECT id, email, created_at, role, COALESCE(disabled, 0) as disabled, COALESCE(read_only, 0) as read_only, COALESCE(disk_bytes_used, 0) as disk_bytes_used, last_login_at, last_login_ip, last_login_location, max_podcasts, max_episodes, max_storage_mb, max_collaborators, max_subscriber_tokens, COALESCE(can_transcribe, 0) as can_transcribe FROM users WHERE id = ?",
        )
        .get(userId) as User;
      return updated;
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
      const user = db
        .prepare(
          "SELECT id, email, created_at, role, COALESCE(disabled, 0) as disabled, COALESCE(read_only, 0) as read_only, COALESCE(disk_bytes_used, 0) as disk_bytes_used, last_login_at, last_login_ip, last_login_location, max_podcasts, max_episodes, max_storage_mb, max_collaborators, max_subscriber_tokens, COALESCE(can_transcribe, 0) as can_transcribe FROM users WHERE id = ?",
        )
        .get(userId) as User | undefined;
      if (!user) {
        return reply.code(404).send({ error: "User not found" });
      }
      return user;
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

      // Check if user exists
      const user = db
        .prepare("SELECT id FROM users WHERE id = ?")
        .get(userId) as { id: string } | undefined;
      if (!user) {
        return reply.code(404).send({ error: "User not found" });
      }

      // Delete user
      db.prepare("DELETE FROM users WHERE id = ?").run(userId);

      return { success: true };
    },
  );
}
