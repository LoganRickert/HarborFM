import type { FastifyInstance } from "fastify";
import argon2 from "argon2";
import { eq, sql } from "drizzle-orm";
import { drizzleDb } from "../../db/index.js";
import { users } from "../../db/schema.js";
import { sqlNow } from "../../db/utils.js";
import { loginBodySchema, parseTwoFactorMethods } from "@harborfm/shared";
import { readSettings, isEmailProviderConfigured } from "../settings/index.js";
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
  CSRF_COOKIE_NAME,
  JWT_COOKIE_NAME,
  JWT_SESSION_EXPIRY,
} from "../../config.js";
import {
  COOKIE_OPTS,
  CSRF_COOKIE_OPTS,
  buildAuthJwtPayload,
  create2FAChallenge,
  buildSetupMethods,
  resolve2FAMethod,
  newCsrfToken,
  redactEmail,
  TWOFA_CHALLENGE_COOKIE_OPTS,
} from "./shared.js";
import { TWOFA_CHALLENGE_COOKIE_NAME } from "../../config.js";

export async function registerLoginRoutes(app: FastifyInstance) {
  const timingDummyHash = await argon2.hash("timing-dummy");
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
      const canonicalEmail = email.trim().toLowerCase();
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
      const row = drizzleDb
        .select({
          id: users.id,
          email: users.email,
          username: users.username,
          passwordHash: users.passwordHash,
          disabled: sql<number>`COALESCE(${users.disabled}, 0)`.as("disabled"),
          emailVerified: sql<number>`COALESCE(${users.emailVerified}, 1)`.as(
            "emailVerified",
          ),
          readOnly: sql<number>`COALESCE(${users.readOnly}, 0)`.as("readOnly"),
          twoFactorMethod: users.twoFactorMethod,
          totpSecretEnc: users.totpSecretEnc,
          totpLockedUntil: users.totpLockedUntil,
        })
        .from(users)
        .where(eq(users.email, canonicalEmail))
        .limit(1)
        .get();
      let passwordValid = false;
      if (row?.passwordHash) {
        passwordValid = await argon2.verify(row.passwordHash, password);
      } else {
        await argon2.verify(timingDummyHash, password);
      }
      if (!row || !passwordValid) {
        request.log.warn(
          { emailRedacted: redactEmail(canonicalEmail), ip },
          "Login failed: invalid credentials",
        );
        // Record failed attempt unless banned (checked above).
        const after = recordFailureAndMaybeBan(ip, "auth_login", {
          attemptedEmail: canonicalEmail,
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
          { userId: row.id, emailRedacted: redactEmail(canonicalEmail), ip },
          "Login rejected: account disabled",
        );
        return reply.status(401).send({ error: "Invalid email or password" });
      }
      if (
        isEmailProviderConfigured(settings) && row.emailVerified === 0
      ) {
        request.log.warn(
          { userId: row.id, emailRedacted: redactEmail(canonicalEmail), ip },
          "Login rejected: email not verified",
        );
        return reply.status(401).send({ error: "Invalid email or password" });
      }

      // Successful login: clear failures for this IP/context (best-effort).
      clearFailures(ip, "auth_login");

      // Record last login metadata (best-effort).
      try {
        const location = await getLocationForIp(ip).catch(() => null);
        drizzleDb
          .update(users)
          .set({
            lastLoginAt: sqlNow(),
            lastLoginIp: ip,
            lastLoginUserAgent: userAgent,
            lastLoginLocation: location ?? null,
          })
          .where(eq(users.id, row.id))
          .run();
      } catch {
        // ignore
      }

      const twoFactorEnabled = Boolean(settings.two_factor_enabled);
      const twoFactorEnforced = Boolean(settings.two_factor_enforced);
      const allowedMethods = parseTwoFactorMethods(
        settings.two_factor_methods || "totp",
      );
      const userHas2FA = Boolean(row.twoFactorMethod?.trim());
      const emailProviderConfigured = isEmailProviderConfigured(settings);

      const setupMethods = buildSetupMethods(
        allowedMethods,
        emailProviderConfigured,
        row,
      );

      // 2FA enforced and user has no 2FA: must setup before proceeding (skip for read-only accounts)
      if (
        twoFactorEnabled &&
        twoFactorEnforced &&
        !userHas2FA &&
        row.readOnly !== 1
      ) {
        const { challengeToken } = create2FAChallenge(
          row.id,
          setupMethods[0] ?? "totp",
        );
        return reply
          .setCookie(TWOFA_CHALLENGE_COOKIE_NAME, challengeToken, TWOFA_CHALLENGE_COOKIE_OPTS)
          .header("Cache-Control", "no-store")
          .send({
            requires2FASetup: true,
            methods: setupMethods,
          });
      }

      // User has 2FA: require TOTP or email code before issuing JWT
      if (twoFactorEnabled && userHas2FA) {
        const method = resolve2FAMethod(
          row,
          allowedMethods,
          emailProviderConfigured,
        );
        const { challengeToken } = create2FAChallenge(row.id, method);
        return reply
          .setCookie(TWOFA_CHALLENGE_COOKIE_NAME, challengeToken, TWOFA_CHALLENGE_COOKIE_OPTS)
          .header("Cache-Control", "no-store")
          .send({
            requires2FA: true,
            method,
          });
      }

      const token = app.jwt.sign(
        buildAuthJwtPayload(row),
        { expiresIn: JWT_SESSION_EXPIRY },
      );
      return reply
        .setCookie(JWT_COOKIE_NAME, token, COOKIE_OPTS)
        .setCookie(CSRF_COOKIE_NAME, newCsrfToken(), CSRF_COOKIE_OPTS)
        .send({ user: { id: row.id, email } });
    },
  );
}
