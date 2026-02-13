import type { FastifyInstance } from "fastify";
import argon2 from "argon2";
import { requireAuth, requireNotReadOnly } from "../../plugins/auth.js";
import { nanoid } from "nanoid";
import { db } from "../../db/index.js";
import {
  registerBodySchema,
  loginBodySchema,
  forgotPasswordBodySchema,
  resetPasswordBodySchema,
  authTokenQuerySchema,
  authInviteBodySchema,
  authApiKeyCreateBodySchema,
  authApiKeyUpdateBodySchema,
  authApiKeyIdParamSchema,
  authApiKeyListQuerySchema,
} from "@harborfm/shared";
import { readSettings } from "../settings/index.js";
import { randomBytes } from "crypto";
import { getCookieSecureFlag } from "../../services/cookies.js";
import {
  clearFailures,
  getClientIp,
  getIpBan,
  getUserAgent,
  recordFailureAndMaybeBan,
} from "../../services/loginAttempts.js";
import { getLocationForIp } from "../../services/geolocation.js";
import { verifyCaptcha } from "../../services/captcha.js";
import {
  sendMail,
  buildWelcomeVerificationEmail,
  buildWelcomeVerifiedEmail,
  buildResetPasswordEmail,
  buildInviteToPlatformEmail,
} from "../../services/email.js";
import { normalizeHostname } from "../../utils/url.js";
import { sha256Hex } from "../../utils/hash.js";
import {
  MAX_PLATFORM_INVITES_PER_DAY,
  API_KEY_PREFIX,
  MAX_API_KEYS_PER_USER,
  CSRF_COOKIE_NAME,
  JWT_COOKIE_NAME,
  FORGOT_PASSWORD_RATE_MINUTES,
  RESET_TOKEN_EXPIRY_HOURS,
} from "../../config.js";

const VERIFICATION_TOKEN_BYTES = 24;
const VERIFICATION_EXPIRY_HOURS = 24;

// In production, cookies are Secure by default (HTTPS only). Set COOKIE_SECURE=false when using HTTP (e.g. Docker on localhost).
const COOKIE_SECURE = getCookieSecureFlag();
const COOKIE_OPTS = {
  httpOnly: true,
  secure: COOKIE_SECURE,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * 7, // 7 days
};
const CSRF_COOKIE_OPTS = {
  httpOnly: false,
  secure: COOKIE_SECURE,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * 7, // 7 days
};

/** Redact email for logging (avoid logging username in plain text). */
function redactEmail(email: string): string {
  const s = email.trim();
  if (!s || !s.includes("@")) return "(invalid)";
  const [local, domain] = s.split("@");
  if (!domain) return "(invalid)";
  const showLocal = local.length <= 2 ? "**" : local.slice(0, 1) + "***";
  return `${showLocal}@${domain}`;
}

function newCsrfToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function authRoutes(app: FastifyInstance) {
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
          settings.email_provider === "sendgrid") &&
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
          .send({ error: parsed.error.issues[0]?.message ?? "Missing verification token", details: parsed.error.flatten() });
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
          settings.email_provider === "sendgrid") &&
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

  app.post(
    "/auth/login",
    {
      schema: {
        tags: ["Auth"],
        summary: "Login",
        description:
          "Sign in with email and password. Sets HTTP-only cookie. No authentication required.",
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
          200: { description: "User and session" },
          400: { description: "Validation or CAPTCHA failed" },
          401: { description: "Invalid credentials" },
          403: { description: "Account disabled or email not verified" },
          429: { description: "Rate limited" },
        },
      },
    },
    async (request, reply) => {
      const ip = getClientIp(request);
      const userAgent = getUserAgent(request);
      const ban = getIpBan(ip, "auth_login");
      if (ban.banned) {
        return reply
          .status(429)
          .header("Retry-After", String(ban.retryAfterSec))
          .send({
            error:
              "Too many failed login attempts. Try again in a few minutes.",
          });
      }

      const body = request.body as Record<string, unknown>;
      const parsed = loginBodySchema.safeParse(request.body);
      if (!parsed.success) {
        request.log.warn(
          { err: parsed.error.flatten(), ip },
          "Login validation failed",
        );
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

      const settings = readSettings();
      if (settings.captcha_provider && settings.captcha_provider !== "none") {
        if (!captchaToken || !captchaToken.trim()) {
          request.log.warn(
            {
              emailRedacted: redactEmail(email),
              ip,
              captchaProvider: settings.captcha_provider,
            },
            "Login rejected: CAPTCHA required but no token received",
          );
          return reply
            .status(400)
            .send({
              error: "CAPTCHA is required. Please complete the challenge.",
            });
        }
        const verify = await verifyCaptcha(
          settings.captcha_provider,
          settings.captcha_secret_key,
          captchaToken,
          ip,
        );
        if (!verify.ok) {
          request.log.warn(
            {
              emailRedacted: redactEmail(email),
              ip,
              captchaProvider: settings.captcha_provider,
              verifyError: verify.error,
            },
            "Login rejected: CAPTCHA verification failed",
          );
          return reply
            .status(400)
            .send({ error: verify.error ?? "CAPTCHA verification failed" });
        }
      }
      const row = db
        .prepare(
          "SELECT id, password_hash, COALESCE(disabled, 0) as disabled, COALESCE(email_verified, 1) as email_verified FROM users WHERE email = ?",
        )
        .get(email) as
        | {
            id: string;
            password_hash: string;
            disabled: number;
            email_verified: number;
          }
        | undefined;
      if (!row || !(await argon2.verify(row.password_hash, password))) {
        request.log.warn(
          { emailRedacted: redactEmail(email), ip },
          "Login failed: invalid credentials",
        );
        // Record failed attempt unless banned (checked above).
        const after = recordFailureAndMaybeBan(ip, "auth_login", {
          attemptedEmail: email,
          userAgent,
        });
        if (after.bannedNow) {
          return reply
            .status(429)
            .header("Retry-After", String(after.retryAfterSec))
            .send({
              error:
                "Too many failed login attempts. Try again in a few minutes.",
            });
        }
        return reply.status(401).send({ error: "Invalid email or password" });
      }
      if (row.disabled === 1) {
        request.log.warn(
          { userId: row.id, emailRedacted: redactEmail(email), ip },
          "Login rejected: account disabled",
        );
        return reply.status(403).send({ error: "Account is disabled" });
      }
      if (
        (settings.email_provider === "smtp" ||
          settings.email_provider === "sendgrid") &&
        row.email_verified === 0
      ) {
        request.log.warn(
          { userId: row.id, emailRedacted: redactEmail(email), ip },
          "Login rejected: email not verified",
        );
        return reply.status(403).send({
          error:
            "Please verify your email before signing in. Check your inbox for the verification link.",
        });
      }

      // Successful login: clear failures for this IP/context (best-effort).
      clearFailures(ip, "auth_login");

      // Record last login metadata (best-effort).
      try {
        const location = await getLocationForIp(ip).catch(() => null);
        db.prepare(
          `UPDATE users SET last_login_at = datetime('now'), last_login_ip = ?, last_login_user_agent = ?, last_login_location = ? WHERE id = ?`,
        ).run(ip, userAgent, location ?? null, row.id);
      } catch {
        // ignore
      }

      const token = app.jwt.sign({ sub: row.id, email }, { expiresIn: "7d" });
      return reply
        .setCookie(JWT_COOKIE_NAME, token, COOKIE_OPTS)
        .setCookie(CSRF_COOKIE_NAME, newCsrfToken(), CSRF_COOKIE_OPTS)
        .send({ user: { id: row.id, email } });
    },
  );

  const RESET_TOKEN_BYTES = 32;

  app.post(
    "/auth/forgot-password",
    {
      schema: {
        tags: ["Auth"],
        summary: "Forgot password",
        description:
          "Request a password reset email. No authentication required. Always returns 200 when email is valid. CAPTCHA required when enabled.",
        security: [],
        body: {
          type: "object",
          properties: {
            email: { type: "string" },
            captchaToken: { type: "string" },
          },
          required: ["email"],
        },
        response: {
          200: { description: "OK" },
          400: { description: "Email or CAPTCHA invalid" },
          429: { description: "Rate limited" },
          503: { description: "Email not configured" },
        },
      },
    },
    async (request, reply) => {
      const settings = readSettings();
      if (
        settings.email_provider !== "smtp" &&
        settings.email_provider !== "sendgrid"
      ) {
        return reply.status(503).send({
          error:
            "Password reset is not available. No email service is configured.",
        });
      }
      if (!settings.email_enable_password_reset) {
        return reply.status(503).send({
          error: "Password reset emails are disabled in settings.",
        });
      }
      const parsed = forgotPasswordBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({
            error: "Validation failed",
            details: parsed.error.flatten(),
          });
      }
      const email = parsed.data.email.trim().toLowerCase();
      const captchaToken = parsed.data.captchaToken?.trim();

      if (settings.captcha_provider && settings.captcha_provider !== "none") {
        if (!captchaToken) {
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
          request.log.warn(
            {
              captchaProvider: settings.captcha_provider,
              verifyError: verify.error,
            },
            "Forgot password: CAPTCHA verification failed",
          );
          return reply
            .status(400)
            .send({ error: verify.error ?? "CAPTCHA verification failed" });
        }
      }

      // Rate limit per email before checking if account exists, so response is identical
      // whether the email is registered or not (prevents email enumeration).
      const lastAttempt = db
        .prepare(
          "SELECT attempted_at FROM forgot_password_attempts WHERE email = ?",
        )
        .get(email) as { attempted_at: string } | undefined;

      const minIntervalMs = FORGOT_PASSWORD_RATE_MINUTES * 60 * 1000;

      if (
        lastAttempt &&
        Date.now() - new Date(lastAttempt.attempted_at).getTime() <
          minIntervalMs
      ) {
        return reply.status(429).send({
          error: `You can only request a password reset once every ${FORGOT_PASSWORD_RATE_MINUTES} minutes.`,
        });
      }

      const now = new Date().toISOString();
      const ip = getClientIp(request);
      const userAgent = getUserAgent(request);
      db.prepare(
        "INSERT INTO forgot_password_attempts (email, attempted_at, ip, user_agent) VALUES (?, ?, ?, ?) ON CONFLICT (email) DO UPDATE SET attempted_at = excluded.attempted_at, ip = excluded.ip, user_agent = excluded.user_agent",
      ).run(email, now, ip, userAgent ?? null);

      // Prune attempts older than 24h to avoid unbounded growth
      db.prepare(
        "DELETE FROM forgot_password_attempts WHERE attempted_at < datetime('now', '-1 day')",
      ).run();

      const user = db
        .prepare(
          "SELECT id, COALESCE(disabled, 0) AS disabled, COALESCE(read_only, 0) AS read_only FROM users WHERE email = ?",
        )
        .get(email) as
        | { id: string; disabled: number; read_only: number }
        | undefined;
      if (!user) {
        return reply.send({ ok: true });
      }

      // Do not send reset email if account is disabled OR read-only
      if (user.disabled === 1 || user.read_only === 1) {
        return reply.send({ ok: true });
      }

      const token = randomBytes(RESET_TOKEN_BYTES).toString("base64url");
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + RESET_TOKEN_EXPIRY_HOURS);
      db.prepare(
        "INSERT INTO password_reset_tokens (email, token, expires_at, created_at) VALUES (?, ?, ?, ?)",
      ).run(email, token, expiresAt.toISOString(), now);

      const baseUrl =
        normalizeHostname(settings.hostname || "") || "http://localhost";
      const resetUrl = `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`;
      const { subject, text, html } = buildResetPasswordEmail(
        resetUrl,
        RESET_TOKEN_EXPIRY_HOURS,
      );
      const sendResult = await sendMail({ to: email, subject, text, html });
      if (!sendResult.sent) {
        request.log.warn(
          { emailRedacted: redactEmail(email), err: sendResult.error },
          "Password reset email failed to send",
        );
      }
      return reply.send({ ok: true });
    },
  );

  app.get(
    "/auth/validate-reset-token",
    {
      schema: {
        tags: ["Auth"],
        summary: "Validate reset token",
        description:
          "Check if a password reset token is valid. No authentication required.",
        security: [],
        querystring: {
          type: "object",
          properties: { token: { type: "string" } },
          required: ["token"],
        },
        response: {
          200: { description: "Token valid" },
          400: { description: "Invalid or expired" },
        },
      },
    },
    async (request, reply) => {
      const parsed = authTokenQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: parsed.error.issues[0]?.message ?? "Token is required", details: parsed.error.flatten() });
      }
      const token = parsed.data.token.trim();
      const row = db
        .prepare(
          "SELECT 1 FROM password_reset_tokens WHERE token = ? AND expires_at > datetime('now')",
        )
        .get(token);
      if (!row) {
        return reply
          .status(400)
          .send({
            error:
              "Invalid or expired reset link. Request a new one from the reset password page.",
          });
      }
      return reply.send({ ok: true });
    },
  );

  app.post(
    "/auth/reset-password",
    {
      schema: {
        tags: ["Auth"],
        summary: "Reset password",
        description:
          "Set new password using token from reset email. No authentication required.",
        security: [],
        body: {
          type: "object",
          properties: {
            token: { type: "string" },
            password: { type: "string" },
          },
          required: ["token", "password"],
        },
        response: {
          200: { description: "Password updated" },
          400: { description: "Invalid token or password too short" },
        },
      },
    },
    async (request, reply) => {
      const parsed = resetPasswordBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({
            error: parsed.error.issues[0]?.message ?? "Validation failed",
            details: parsed.error.flatten(),
          });
      }
      const { token, password } = parsed.data;

      const row = db
        .prepare(
          "SELECT email FROM password_reset_tokens WHERE token = ? AND expires_at > datetime('now')",
        )
        .get(token) as { email: string } | undefined;
      if (!row) {
        return reply
          .status(400)
          .send({
            error:
              "Invalid or expired reset link. Request a new one from the reset password page.",
          });
      }

      const password_hash = await argon2.hash(password);
      db.prepare("UPDATE users SET password_hash = ? WHERE email = ?").run(
        password_hash,
        row.email,
      );
      db.prepare("DELETE FROM password_reset_tokens WHERE token = ?").run(
        token,
      );
      return reply.send({ ok: true });
    },
  );

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
      return {
        id: user.id,
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

  function requireSession(
    request: { authViaApiKey?: boolean; userId: string },
    reply: {
      status: (code: number) => { send: (body: unknown) => unknown };
      sent?: boolean;
    },
  ): boolean {
    if (request.authViaApiKey) {
      reply
        .status(403)
        .send({
          error: "API key management requires signing in with your password.",
        });
      return false;
    }
    return true;
  }

  app.get(
    "/auth/api-keys",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Auth"],
        summary: "List API keys",
        description:
          "List your API keys with optional pagination, search by name, and sort. Requires session (not API key).",
        querystring: {
          type: "object",
          properties: {
            limit: { type: "number", minimum: 1, maximum: 100, default: 10 },
            offset: { type: "number", minimum: 0, default: 0 },
            q: { type: "string" },
            sort: {
              type: "string",
              enum: ["newest", "oldest"],
              default: "newest",
            },
          },
        },
        response: {
          200: { description: "List of API keys with total" },
          401: { description: "Unauthorized" },
          403: { description: "Use session to manage keys" },
        },
      },
    },
    async (request, reply) => {
      if (
        !requireSession(request, reply as Parameters<typeof requireSession>[1])
      )
        return;
      const queryParsed = authApiKeyListQuerySchema.safeParse(request.query);
      const raw = queryParsed.success ? queryParsed.data : {};
      const limit = raw.limit ?? 10;
      const offset = raw.offset ?? 0;
      const q = raw.q;
      const sort = raw.sort ?? "newest";
      let whereClause = "user_id = ?";
      const params: (string | number)[] = [request.userId];
      if (q && q.trim()) {
        whereClause += " AND name LIKE ?";
        params.push(`%${q.trim()}%`);
      }
      const countResult = db
        .prepare(`SELECT COUNT(*) as count FROM api_keys WHERE ${whereClause}`)
        .get(...params) as { count: number };
      const total = countResult.count;
      const orderBy = sort === "oldest" ? "created_at ASC" : "created_at DESC";
      const keys = db
        .prepare(
          `SELECT id, name, valid_until, valid_from, COALESCE(disabled, 0) AS disabled, created_at, last_used_at
         FROM api_keys
         WHERE ${whereClause}
         ORDER BY ${orderBy}
         LIMIT ? OFFSET ?`,
        )
        .all(...params, limit, offset) as {
        id: string;
        name: string | null;
        valid_until: string | null;
        valid_from: string | null;
        disabled: number;
        created_at: string;
        last_used_at: string | null;
      }[];
      return { api_keys: keys, total };
    },
  );

  app.post(
    "/auth/api-keys",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Auth"],
        summary: "Create API key",
        description:
          "Generate a new API key. Optional name, valid_until (ISO), valid_from (ISO). Raw key returned only once. Max 5 per user. Requires session (not API key).",
        body: {
          type: "object",
          properties: {
            name: { type: "string" },
            valid_until: { type: "string", description: "ISO datetime" },
            valid_from: { type: "string", description: "ISO datetime" },
          },
        },
        response: {
          201: { description: "New key" },
          400: { description: "At key limit" },
          401: { description: "Unauthorized" },
          403: { description: "Use session or read-only" },
        },
      },
    },
    async (request, reply) => {
      if (
        !requireSession(request, reply as Parameters<typeof requireSession>[1])
      )
        return;
      const count = db
        .prepare("SELECT COUNT(*) as count FROM api_keys WHERE user_id = ?")
        .get(request.userId) as { count: number };
      if (count.count >= MAX_API_KEYS_PER_USER) {
        return reply.status(400).send({
          error: `You can have at most ${MAX_API_KEYS_PER_USER} API keys. Revoke one to create a new one.`,
        });
      }
      const bodyParsed = authApiKeyCreateBodySchema.safeParse(request.body);
      if (!bodyParsed.success) {
        return reply
          .status(400)
          .send({ error: bodyParsed.error.issues[0]?.message ?? "Validation failed", details: bodyParsed.error.flatten() });
      }
      const body = bodyParsed.data;
      const name = body.name?.trim() ?? null;
      const validUntil = body.valid_until?.trim() ?? null;
      const validFrom = body.valid_from?.trim() ?? null;
      const id = nanoid();
      const rawKey = API_KEY_PREFIX + randomBytes(32).toString("hex");
      const keyHash = sha256Hex(rawKey);
      db.prepare(
        "INSERT INTO api_keys (id, user_id, key_hash, name, valid_until, valid_from, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))",
      ).run(id, request.userId, keyHash, name, validUntil, validFrom);
      const row = db
        .prepare(
          "SELECT id, name, valid_until, valid_from, COALESCE(disabled, 0) AS disabled, created_at FROM api_keys WHERE id = ?",
        )
        .get(id) as {
        id: string;
        name: string | null;
        valid_until: string | null;
        valid_from: string | null;
        disabled: number;
        created_at: string;
      };
      return reply.status(201).send({
        id: row.id,
        key: rawKey,
        name: row.name,
        valid_until: row.valid_until,
        valid_from: row.valid_from,
        disabled: row.disabled,
        created_at: row.created_at,
      });
    },
  );

  app.patch(
    "/auth/api-keys/:id",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Auth"],
        summary: "Update API key",
        description:
          "Update an API key (name, valid_until, valid_from, disabled). Requires session (not API key).",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        body: {
          type: "object",
          properties: {
            name: { type: "string" },
            valid_until: { type: "string", description: "ISO datetime" },
            valid_from: { type: "string", description: "ISO datetime" },
            disabled: { type: "boolean" },
          },
        },
        response: {
          200: { description: "Updated key" },
          400: { description: "Validation failed" },
          401: { description: "Unauthorized" },
          403: { description: "Use session or read-only" },
          404: { description: "Key not found" },
        },
      },
    },
    async (request, reply) => {
      if (
        !requireSession(request, reply as Parameters<typeof requireSession>[1])
      )
        return;
      const paramsParsed = authApiKeyIdParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return reply
          .status(400)
          .send({ error: paramsParsed.error.issues[0]?.message ?? "Validation failed", details: paramsParsed.error.flatten() });
      }
      const { id } = paramsParsed.data;
      const existing = db
        .prepare("SELECT id FROM api_keys WHERE id = ? AND user_id = ?")
        .get(id, request.userId);
      if (!existing) {
        return reply.status(404).send({ error: "API key not found" });
      }
      const bodyParsed = authApiKeyUpdateBodySchema.safeParse(request.body);
      if (!bodyParsed.success) {
        return reply
          .status(400)
          .send({ error: bodyParsed.error.issues[0]?.message ?? "Validation failed", details: bodyParsed.error.flatten() });
      }
      const body = bodyParsed.data;
      const updates: string[] = [];
      const values: unknown[] = [];
      if (body.name !== undefined) {
        updates.push("name = ?");
        values.push(typeof body.name === "string" ? body.name.trim() || null : null);
      }
      if (body.valid_until !== undefined) {
        updates.push("valid_until = ?");
        values.push(typeof body.valid_until === "string" ? body.valid_until.trim() || null : null);
      }
      if (body.valid_from !== undefined) {
        updates.push("valid_from = ?");
        values.push(typeof body.valid_from === "string" ? body.valid_from.trim() || null : null);
      }
      if (body.disabled !== undefined) {
        updates.push("disabled = ?");
        values.push(body.disabled ? 1 : 0);
      }
      if (updates.length === 0) {
        const row = db
          .prepare(
            "SELECT id, name, valid_until, valid_from, COALESCE(disabled, 0) AS disabled, created_at, last_used_at FROM api_keys WHERE id = ? AND user_id = ?",
          )
          .get(id, request.userId) as {
          id: string;
          name: string | null;
          valid_until: string | null;
          valid_from: string | null;
          disabled: number;
          created_at: string;
          last_used_at: string | null;
        };
        return reply.status(200).send(row);
      }
      values.push(id, request.userId);
      db.prepare(
        `UPDATE api_keys SET ${updates.join(", ")} WHERE id = ? AND user_id = ?`,
      ).run(...values);
      const row = db
        .prepare(
          "SELECT id, name, valid_until, valid_from, COALESCE(disabled, 0) AS disabled, created_at, last_used_at FROM api_keys WHERE id = ? AND user_id = ?",
        )
        .get(id, request.userId) as {
        id: string;
        name: string | null;
        valid_until: string | null;
        valid_from: string | null;
        disabled: number;
        created_at: string;
        last_used_at: string | null;
      };
      return reply.status(200).send(row);
    },
  );

  app.delete(
    "/auth/api-keys/:id",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Auth"],
        summary: "Revoke API key",
        description:
          "Permanently revoke an API key. Requires session (not API key).",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        response: {
          204: { description: "Revoked" },
          400: { description: "Validation failed" },
          401: { description: "Unauthorized" },
          403: { description: "Use session or read-only" },
          404: { description: "Key not found" },
        },
      },
    },
    async (request, reply) => {
      if (
        !requireSession(request, reply as Parameters<typeof requireSession>[1])
      )
        return;
      const paramsParsed = authApiKeyIdParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return reply
          .status(400)
          .send({ error: paramsParsed.error.issues[0]?.message ?? "Validation failed", details: paramsParsed.error.flatten() });
      }
      const { id } = paramsParsed.data;
      const existing = db
        .prepare("SELECT id FROM api_keys WHERE id = ? AND user_id = ?")
        .get(id, request.userId);
      if (!existing) {
        return reply.status(404).send({ error: "API key not found" });
      }
      db.prepare("DELETE FROM api_keys WHERE id = ?").run(id);
      return reply.status(204).send();
    },
  );

  app.post(
    "/invite-to-platform",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Auth"],
        summary: "Invite someone to join the platform",
        description:
          "Send an email inviting the recipient to create an account. Rate limited per user per day.",
        body: {
          type: "object",
          properties: { email: { type: "string" } },
          required: ["email"],
        },
        response: {
          200: { description: "Invite sent" },
          400: { description: "Invalid email or already sent" },
          429: { description: "Rate limited" },
          503: { description: "Email not configured" },
        },
      },
    },
    async (request, reply) => {
      const parsed = authInviteBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: parsed.error.issues[0]?.message ?? "Valid email is required", details: parsed.error.flatten() });
      }
      const email = parsed.data.email.trim().toLowerCase();
      const userId = request.userId as string;
      const countLast24h = db
        .prepare(
          `SELECT COUNT(*) as count FROM platform_invites WHERE inviter_user_id = ? AND created_at > datetime('now', '-1 day')`,
        )
        .get(userId) as { count: number };
      if (countLast24h.count >= MAX_PLATFORM_INVITES_PER_DAY) {
        return reply
          .status(429)
          .send({
            error:
              "You have reached the limit of platform invites per day. Try again tomorrow.",
          });
      }
      const sameEmailRecent = db
        .prepare(
          `SELECT 1 FROM platform_invites WHERE LOWER(email) = ? AND created_at > datetime('now', '-1 day') LIMIT 1`,
        )
        .get(email);
      if (sameEmailRecent) {
        return reply
          .status(400)
          .send({
            error:
              "An invite was already sent to this email recently. Please wait 24 hours.",
          });
      }
      const settings = readSettings();
      if (settings.email_provider === "none") {
        return reply
          .status(503)
          .send({
            error:
              "Email is not configured. Ask an administrator to set up email.",
          });
      }
      if (!settings.email_enable_invite) {
        return reply
          .status(503)
          .send({ error: "Invite emails are disabled in settings." });
      }
      const baseUrl =
        normalizeHostname(settings.hostname || "") || "http://localhost";
      const signupUrl = `${baseUrl}/signup`;
      const { subject, text, html } = buildInviteToPlatformEmail(signupUrl);
      const sendResult = await sendMail({ to: email, subject, text, html });
      if (!sendResult.sent) {
        request.log.warn(
          { emailRedacted: email.slice(0, 3) + "***", err: sendResult.error },
          "Invite-to-platform email failed",
        );
        return reply
          .status(503)
          .send({ error: sendResult.error ?? "Failed to send email" });
      }
      db.prepare(
        "INSERT INTO platform_invites (inviter_user_id, email) VALUES (?, ?)",
      ).run(userId, email);
      return reply.send({ ok: true });
    },
  );
}
