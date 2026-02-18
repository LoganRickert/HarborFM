import type { FastifyInstance } from "fastify";
import argon2 from "argon2";
import { nanoid } from "nanoid";
import { randomBytes } from "crypto";
import { db } from "../../db/index.js";
import {
  loginBodySchema,
  TWO_FACTOR_METHODS,
  parseTwoFactorMethods,
  isMethodAllowed,
} from "@harborfm/shared";
import { readSettings } from "../settings/index.js";
import {
  clearFailures,
  getClientIp,
  getIpBan,
  getUserAgent,
  recordFailureAndMaybeBan,
} from "../../services/loginAttempts.js";
import { getLocationForIp } from "../../services/geolocation.js";
import { verifyCaptcha } from "../../services/captcha.js";
import { sha256Hex } from "../../utils/hash.js";
import { CSRF_COOKIE_NAME, JWT_COOKIE_NAME } from "../../config.js";
import {
  COOKIE_OPTS,
  CSRF_COOKIE_OPTS,
  newCsrfToken,
  redactEmail,
} from "./shared.js";

export async function registerLoginRoutes(app: FastifyInstance) {
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
          "SELECT id, password_hash, COALESCE(disabled, 0) as disabled, COALESCE(email_verified, 1) as email_verified, COALESCE(read_only, 0) as read_only, two_factor_method, totp_secret_enc, totp_locked_until FROM users WHERE email = ?",
        )
        .get(email) as
        | {
            id: string;
            password_hash: string;
            disabled: number;
            email_verified: number;
            read_only: number;
            two_factor_method: string | null;
            totp_secret_enc: string | null;
            totp_locked_until: string | null;
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
          settings.email_provider === "sendgrid" ||
          settings.email_provider === "webhook") &&
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

      const twoFactorEnabled = Boolean(settings.two_factor_enabled);
      const twoFactorEnforced = Boolean(settings.two_factor_enforced);
      const allowedMethods = parseTwoFactorMethods(
        settings.two_factor_methods || "totp",
      );
      const userHas2FA = Boolean(row.two_factor_method?.trim());
      const emailProviderConfigured =
        settings.email_provider === "smtp" ||
        settings.email_provider === "sendgrid" ||
        settings.email_provider === "webhook";

      // Build list of methods available for 2FA setup (implemented + allowed + provider if needed).
      const setupMethods = TWO_FACTOR_METHODS.filter((m) => {
        if (!isMethodAllowed(allowedMethods, m.id)) return false;
        if (m.requiresProvider === "email") return emailProviderConfigured;
        return true;
      }).map((m) => m.id);

      // 2FA enforced and user has no 2FA: must setup before proceeding (skip for read-only accounts)
      if (
        twoFactorEnabled &&
        twoFactorEnforced &&
        !userHas2FA &&
        row.read_only !== 1
      ) {
        const challengeId = nanoid(32);
        const challengeToken = randomBytes(24).toString("base64url");
        const tokenHash = sha256Hex(challengeToken);
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
        db.prepare(
          `INSERT INTO auth_2fa_challenges (id, user_id, token_hash, method, expires_at) VALUES (?, ?, ?, ?, ?)`,
        ).run(
          challengeId,
          row.id,
          tokenHash,
          setupMethods[0] ?? "totp",
          expiresAt,
        );
        return reply.send({
          requires2FASetup: true,
          challengeToken,
          methods: setupMethods,
        });
      }

      // User has 2FA: require TOTP or email code before issuing JWT
      if (twoFactorEnabled && userHas2FA) {
        const userMethods = parseTwoFactorMethods(row.two_factor_method);
        const emailAvailable =
          isMethodAllowed(allowedMethods, "email") && emailProviderConfigured;
        const method =
          userMethods.includes("email") && emailAvailable ? "email" : "totp";
        const challengeId = nanoid(32);
        const challengeToken = randomBytes(24).toString("base64url");
        const tokenHash = sha256Hex(challengeToken);
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
        db.prepare(
          `INSERT INTO auth_2fa_challenges (id, user_id, token_hash, method, expires_at) VALUES (?, ?, ?, ?, ?)`,
        ).run(challengeId, row.id, tokenHash, method, expiresAt);
        return reply.send({
          requires2FA: true,
          challengeToken,
          method,
        });
      }

      const token = app.jwt.sign({ sub: row.id, email }, { expiresIn: "7d" });
      return reply
        .setCookie(JWT_COOKIE_NAME, token, COOKIE_OPTS)
        .setCookie(CSRF_COOKIE_NAME, newCsrfToken(), CSRF_COOKIE_OPTS)
        .send({ user: { id: row.id, email } });
    },
  );
}
