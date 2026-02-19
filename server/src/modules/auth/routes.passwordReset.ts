import type { FastifyInstance } from "fastify";
import argon2 from "argon2";
import { randomBytes } from "crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import { drizzleDb } from "../../db/index.js";
import {
  forgotPasswordAttempts,
  passwordResetTokens,
  passwordResetTotpAttempts,
  users,
} from "../../db/schema.js";
import { sqlNow } from "../../db/utils.js";
import {
  forgotPasswordBodySchema,
  resetPasswordBodySchema,
  authTokenQuerySchema,
} from "@harborfm/shared";
import { readSettings, isEmailProviderConfigured } from "../settings/index.js";
import { getClientIp, getUserAgent } from "../../services/loginAttempts.js";
import { verifyCaptcha } from "../../services/captcha.js";
import { sendMail, buildResetPasswordEmail } from "../../services/email.js";
import { getBaseUrl } from "./shared.js";
import { sha256Hex } from "../../utils/hash.js";
import {
  FORGOT_PASSWORD_RATE_MINUTES,
  FORGOT_PASSWORD_IP_RATE_LIMIT_MAX,
  RESET_TOKEN_EXPIRY_HOURS,
} from "../../config.js";
import { decryptTotpSecret, verifyTotp } from "../../services/twoFactor.js";
import { randomInt } from "crypto";
import { redactEmail, RESET_TOKEN_BYTES } from "./shared.js";

export async function registerPasswordResetRoutes(app: FastifyInstance) {
  app.post(
    "/auth/forgot-password",
    {
      config: {
        rateLimit: {
          max: FORGOT_PASSWORD_IP_RATE_LIMIT_MAX,
          timeWindow: "1 minute",
        },
      },
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
        !isEmailProviderConfigured(settings)
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
      const lastAttempt = drizzleDb
        .select({ attempted_at: forgotPasswordAttempts.attemptedAt })
        .from(forgotPasswordAttempts)
        .where(eq(forgotPasswordAttempts.email, email))
        .limit(1)
        .get();

      const minIntervalMs = FORGOT_PASSWORD_RATE_MINUTES * 60 * 1000;
      const lastAttemptMs = lastAttempt?.attempted_at
        ? new Date(lastAttempt.attempted_at).getTime()
        : NaN;

      if (
        lastAttempt &&
        !Number.isNaN(lastAttemptMs) &&
        Date.now() - lastAttemptMs < minIntervalMs
      ) {
        return reply.status(429).send({
          error: `You can only request a password reset once every ${FORGOT_PASSWORD_RATE_MINUTES} minutes.`,
        });
      }

      const now = new Date().toISOString();
      const ip = getClientIp(request);
      const userAgent = getUserAgent(request);
      drizzleDb
        .insert(forgotPasswordAttempts)
        .values({
          email,
          attemptedAt: now,
          ip: ip,
          userAgent: userAgent ?? null,
        })
        .onConflictDoUpdate({
          target: forgotPasswordAttempts.email,
          set: {
            attemptedAt: now,
            ip: ip,
            userAgent: userAgent ?? null,
          },
        })
        .run();

      // Prune attempts older than 24h to avoid unbounded growth
      drizzleDb
        .delete(forgotPasswordAttempts)
        .where(
          sql`${forgotPasswordAttempts.attemptedAt} < datetime('now', '-1 day')`,
        )
        .run();

      const user = drizzleDb
        .select({
          id: users.id,
          password_hash: users.passwordHash,
          disabled: sql<number>`COALESCE(${users.disabled}, 0)`.as("disabled"),
          read_only: sql<number>`COALESCE(${users.readOnly}, 0)`.as("read_only"),
        })
        .from(users)
        .where(eq(users.email, email))
        .limit(1)
        .get();
      if (!user) {
        return reply.send({ ok: true });
      }

      // Do not send reset email if account is disabled, read-only, or federated (no password)
      const isFederated =
        !user.password_hash || user.password_hash.trim() === "";
      if (user.disabled === 1 || user.read_only === 1 || isFederated) {
        return reply.send({ ok: true });
      }

      const token = randomBytes(RESET_TOKEN_BYTES).toString("base64url");
      const tokenHash = sha256Hex(token);
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + RESET_TOKEN_EXPIRY_HOURS);
      drizzleDb
        .delete(passwordResetTokens)
        .where(eq(passwordResetTokens.email, email))
        .run();
      drizzleDb.insert(passwordResetTokens).values({
        email,
        tokenHash,
        expiresAt: expiresAt.toISOString(),
        createdAt: now,
      }).run();

      const baseUrl = getBaseUrl(settings);
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
      config: {
        rateLimit: {
          max: 10,
          timeWindow: "1 minute",
        },
      },
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
          200: {
            description: "Token valid",
            type: "object",
            properties: {
              ok: { type: "boolean" },
              requiresTOTP: { type: "boolean", description: "User has TOTP; totpCode required for reset" },
            },
          },
          400: { description: "Invalid or expired" },
          429: { description: "Rate limited" },
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
              parsed.error.issues[0]?.message ?? "Token is required",
            details: parsed.error.flatten(),
          });
      }
      const token = parsed.data.token.trim();
      const tokenHash = sha256Hex(token);
      const row = drizzleDb
        .select({
          email: passwordResetTokens.email,
          totp_secret_enc: sql<string>`COALESCE(${users.totpSecretEnc}, '')`.as(
            "totp_secret_enc",
          ),
        })
        .from(passwordResetTokens)
        .leftJoin(users, eq(users.email, passwordResetTokens.email))
        .where(
          and(
            eq(passwordResetTokens.tokenHash, tokenHash),
            gt(passwordResetTokens.expiresAt, sqlNow()),
          ),
        )
        .limit(1)
        .get();
      if (!row) {
        return reply
          .status(400)
          .send({
            error:
              "Invalid or expired reset link. Request a new one from the reset password page.",
          });
      }
      const requiresTOTP = Boolean(row.totp_secret_enc?.trim());
      return reply.send({ ok: true, requiresTOTP });
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
            totpCode: { type: "string" },
          },
          required: ["token", "password"],
        },
        response: {
          200: { description: "Password updated" },
          400: { description: "Invalid token or password too short" },
          401: { description: "Invalid TOTP code" },
          429: { description: "Too many failed TOTP attempts" },
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
      const { token, password, totpCode } = parsed.data;

      const tokenHash = sha256Hex(token);
      const row = drizzleDb
        .select({
          email: passwordResetTokens.email,
          totp_secret_enc: users.totpSecretEnc,
        })
        .from(passwordResetTokens)
        .leftJoin(users, eq(users.email, passwordResetTokens.email))
        .where(
          and(
            eq(passwordResetTokens.tokenHash, tokenHash),
            gt(passwordResetTokens.expiresAt, sqlNow()),
          ),
        )
        .limit(1)
        .get();
      if (!row) {
        return reply
          .status(400)
          .send({
            error:
              "Invalid or expired reset link. Request a new one from the reset password page.",
          });
      }

      const hasTOTP = Boolean(row.totp_secret_enc?.trim());
      if (hasTOTP) {
        const code = totpCode?.trim();
        if (!code || code.length < 6) {
          return reply.status(400).send({
            error: "Your account uses two-factor authentication. Enter the 6-digit code from your authenticator app.",
          });
        }
        const failuresRow = drizzleDb
          .select({
            cnt: sql<number>`count(*)`.as("cnt"),
          })
          .from(passwordResetTotpAttempts)
          .where(
            and(
              eq(passwordResetTotpAttempts.tokenHash, tokenHash),
              sql`datetime(${passwordResetTotpAttempts.createdAt}) >= datetime('now', '-15 minutes')`,
            ),
          )
          .get();
        const failures = Number(failuresRow?.cnt ?? 0);
        if (failures >= 5) {
          drizzleDb
            .delete(passwordResetTokens)
            .where(eq(passwordResetTokens.tokenHash, tokenHash))
            .run();
          return reply.status(429).header("Retry-After", "900").send({
            error:
              "Too many failed attempts. Request a new password reset link from the forgot password page.",
          });
        }
        let secret: string;
        try {
          secret = decryptTotpSecret(row.totp_secret_enc!);
        } catch {
          return reply.status(400).send({
            error: "Unable to verify two-factor code. Please try again or contact support.",
          });
        }
        const valid = await verifyTotp(secret, code);
        if (!valid) {
          const delayMs = randomInt(80, 181);
          await new Promise((r) => setTimeout(r, delayMs));
          drizzleDb.insert(passwordResetTotpAttempts).values({
            tokenHash,
            createdAt: new Date().toISOString(),
          }).run();
          return reply.status(401).send({
            error: "Invalid two-factor code. Please try again.",
          });
        }
        drizzleDb
          .delete(passwordResetTotpAttempts)
          .where(eq(passwordResetTotpAttempts.tokenHash, tokenHash))
          .run();
      }

      const password_hash = await argon2.hash(password);
      drizzleDb
        .update(users)
        .set({ passwordHash: password_hash })
        .where(eq(users.email, row.email))
        .run();
      drizzleDb
        .delete(passwordResetTokens)
        .where(eq(passwordResetTokens.tokenHash, tokenHash))
        .run();
      return reply.send({ ok: true });
    },
  );
}
