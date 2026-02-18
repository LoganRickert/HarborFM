import type { FastifyInstance } from "fastify";
import argon2 from "argon2";
import { nanoid } from "nanoid";
import { randomBytes } from "crypto";
import { db } from "../../db/index.js";
import { registerBodySchema, authTokenQuerySchema } from "@harborfm/shared";
import { readSettings } from "../settings/index.js";
import { getClientIp, getUserAgent } from "../../services/loginAttempts.js";
import { getLocationForIp } from "../../services/geolocation.js";
import { verifyCaptcha } from "../../services/captcha.js";
import {
  sendMail,
  buildWelcomeVerificationEmail,
  buildWelcomeVerifiedEmail,
} from "../../services/email.js";
import { normalizeHostname } from "../../utils/url.js";
import { CSRF_COOKIE_NAME, JWT_COOKIE_NAME } from "../../config.js";
import {
  COOKIE_OPTS,
  CSRF_COOKIE_OPTS,
  newCsrfToken,
  redactEmail,
  VERIFICATION_EXPIRY_HOURS,
  VERIFICATION_TOKEN_BYTES,
} from "./shared.js";

export async function registerRegisterRoutes(app: FastifyInstance) {
  app.post(
    "/auth/register",
    {
      schema: {
        tags: ["Auth"],
        summary: "Register",
        description:
          "Create a new account. No authentication required. May require email verification.",
        security: [],
        body: {
          type: "object",
          properties: {
            email: { type: "string" },
            password: { type: "string" },
            captchaToken: { type: "string" },
          },
          required: ["email", "password"],
        },
        response: {
          201: { description: "User created or verification required" },
          400: { description: "Validation failed" },
          403: { description: "Registration disabled" },
          409: { description: "Email already registered" },
        },
      },
    },
    async (request, reply) => {
      // Setup gate: if there are no users, the server must be bootstrapped first.
      // This prevents "first registrant becomes admin" on fresh installs.
      const userCount = db
        .prepare("SELECT COUNT(*) as count FROM users")
        .get() as { count: number };
      if (userCount.count === 0) {
        return reply
          .status(403)
          .send({
            error:
              "Server is not set up yet. Check server logs for the setup URL.",
          });
      }

      // Check if registration is enabled
      const settings = readSettings();
      if (!settings.registration_enabled) {
        return reply
          .status(403)
          .send({ error: "Registration is currently disabled" });
      }

      const body = request.body as Record<string, unknown>;
      const parsed = registerBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({
            error: "Validation failed",
            details: parsed.error.flatten(),
          });
      }
      const { email, password } = parsed.data;
      const captchaToken =
        typeof body?.captchaToken === "string"
          ? body.captchaToken.trim()
          : undefined;

      if (settings.captcha_provider && settings.captcha_provider !== "none") {
        if (!captchaToken || !captchaToken.trim()) {
          return reply
            .status(400)
            .send({
              error: "CAPTCHA is required. Please complete the challenge.",
            });
        }
        const ip = getClientIp(request);
        const verify = await verifyCaptcha(
          settings.captcha_provider,
          settings.captcha_secret_key,
          captchaToken,
          ip,
        );
        if (!verify.ok) {
          return reply
            .status(400)
            .send({ error: verify.error ?? "CAPTCHA verification failed" });
        }
      }

      const existing = db
        .prepare("SELECT id FROM users WHERE email = ?")
        .get(email);
      if (existing) {
        return reply.status(409).send({ error: "Email already registered" });
      }

      const id = nanoid();
      const userRole = "user";
      const password_hash = await argon2.hash(password);
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

      const requiresVerification =
        (settings.email_provider === "smtp" ||
          settings.email_provider === "sendgrid" ||
          settings.email_provider === "webhook") &&
        settings.email_enable_registration_verification;
      let email_verified = 1;
      let email_verification_token: string | null = null;
      let email_verification_expires_at: string | null = null;

      if (requiresVerification) {
        email_verified = 0;
        email_verification_token = randomBytes(
          VERIFICATION_TOKEN_BYTES,
        ).toString("base64url");
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + VERIFICATION_EXPIRY_HOURS);
        email_verification_expires_at = expiresAt.toISOString();
      }

      db.prepare(
        `INSERT INTO users (id, email, password_hash, role, max_podcasts, max_storage_mb, max_episodes, max_collaborators, max_subscriber_tokens, can_transcribe, email_verified, email_verification_token, email_verification_expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        email,
        password_hash,
        userRole,
        max_podcasts,
        max_storage_mb,
        max_episodes,
        max_collaborators,
        max_subscriber_tokens,
        can_transcribe,
        email_verified,
        email_verification_token,
        email_verification_expires_at,
      );

      if (requiresVerification) {
        const baseUrl =
          normalizeHostname(settings.hostname || "") || "http://localhost";
        const verifyUrl = `${baseUrl}/verify-email?token=${encodeURIComponent(email_verification_token!)}`;
        const { subject, text, html } =
          buildWelcomeVerificationEmail(verifyUrl);
        const sendResult = await sendMail({ to: email, subject, text, html });
        if (!sendResult.sent) {
          request.log.warn(
            { emailRedacted: redactEmail(email), err: sendResult.error },
            "Welcome/verification email failed to send",
          );
        }
        return reply.status(201).send({
          requiresVerification: true,
          message: "Check your email to verify your account, then sign in.",
        });
      }

      // No email verification: log in immediately.
      const ip = getClientIp(request);
      const userAgent = getUserAgent(request);
      const location = await getLocationForIp(ip).catch(() => null);
      db.prepare(
        `UPDATE users SET last_login_at = datetime('now'), last_login_ip = ?, last_login_user_agent = ?, last_login_location = ? WHERE id = ?`,
      ).run(ip, userAgent, location ?? null, id);
      const token = app.jwt.sign({ sub: id, email }, { expiresIn: "7d" });
      return reply
        .setCookie(JWT_COOKIE_NAME, token, COOKIE_OPTS)
        .setCookie(CSRF_COOKIE_NAME, newCsrfToken(), CSRF_COOKIE_OPTS)
        .send({ user: { id, email } });
    },
  );

  app.get(
    "/auth/verify-email",
    {
      schema: {
        tags: ["Auth"],
        summary: "Verify email",
        description:
          "Verify email address with token from welcome email. No authentication required. Rejects if account is locked or read-only.",
        security: [],
        querystring: {
          type: "object",
          properties: { token: { type: "string" } },
          required: ["token"],
        },
        response: {
          200: { description: "Email verified" },
          400: { description: "Invalid or expired token" },
          403: { description: "Account locked or read-only" },
        },
      },
    },
    async (request, reply) => {
      const parsed = authTokenQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({
            error:
              parsed.error.issues[0]?.message ?? "Missing verification token",
            details: parsed.error.flatten(),
          });
      }
      const token = parsed.data.token.trim();
      const row = db
        .prepare(
          `SELECT id, email, COALESCE(disabled, 0) AS disabled, COALESCE(read_only, 0) AS read_only FROM users WHERE email_verification_token = ? AND email_verification_expires_at > datetime('now')`,
        )
        .get(token) as
        | { id: string; email: string; disabled: number; read_only: number }
        | undefined;
      if (!row) {
        return reply
          .status(400)
          .send({
            error:
              "Invalid or expired verification link. You can request a new one by registering again or contact support.",
          });
      }
      if (row.disabled === 1) {
        return reply
          .status(403)
          .send({
            error: "This account is locked. Contact the administrator.",
          });
      }
      if (row.read_only === 1) {
        return reply
          .status(403)
          .send({
            error:
              "This account cannot verify email. Contact the administrator.",
          });
      }
      db.prepare(
        `UPDATE users SET email_verified = 1, email_verification_token = NULL, email_verification_expires_at = NULL WHERE id = ?`,
      ).run(row.id);

      const settings = readSettings();
      if (
        (settings.email_provider === "smtp" ||
          settings.email_provider === "sendgrid" ||
          settings.email_provider === "webhook") &&
        settings.email_enable_welcome_after_verify
      ) {
        const baseUrl =
          normalizeHostname(settings.hostname || "") || "http://localhost";
        const { subject, text, html } = buildWelcomeVerifiedEmail(baseUrl);
        const sendResult = await sendMail({
          to: row.email,
          subject,
          text,
          html,
        });
        if (!sendResult.sent) {
          request.log.warn(
            { err: sendResult.error },
            "Welcome email after verification failed to send",
          );
        }
      }

      return reply.send({ ok: true });
    },
  );
}
