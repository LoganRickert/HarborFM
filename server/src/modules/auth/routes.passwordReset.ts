import type { FastifyInstance } from "fastify";
import argon2 from "argon2";
import { randomBytes } from "crypto";
import { db } from "../../db/index.js";
import {
  forgotPasswordBodySchema,
  resetPasswordBodySchema,
  authTokenQuerySchema,
} from "@harborfm/shared";
import { readSettings } from "../settings/index.js";
import { getClientIp, getUserAgent } from "../../services/loginAttempts.js";
import { verifyCaptcha } from "../../services/captcha.js";
import { sendMail, buildResetPasswordEmail } from "../../services/email.js";
import { normalizeHostname } from "../../utils/url.js";
import { sha256Hex } from "../../utils/hash.js";
import {
  FORGOT_PASSWORD_RATE_MINUTES,
  RESET_TOKEN_EXPIRY_HOURS,
} from "../../config.js";
import { decryptTotpSecret, verifyTotp } from "../../services/twoFactor.js";
import { redactEmail, RESET_TOKEN_BYTES } from "./shared.js";

export async function registerPasswordResetRoutes(app: FastifyInstance) {
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
        settings.email_provider !== "sendgrid" &&
        settings.email_provider !== "webhook"
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
      const tokenHash = sha256Hex(token);
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + RESET_TOKEN_EXPIRY_HOURS);
      db.prepare(
        "INSERT INTO password_reset_tokens (email, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)",
      ).run(email, tokenHash, expiresAt.toISOString(), now);

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
          200: {
            description: "Token valid",
            type: "object",
            properties: {
              ok: { type: "boolean" },
              requiresTOTP: { type: "boolean", description: "User has TOTP; totpCode required for reset" },
            },
          },
          400: { description: "Invalid or expired" },
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
      const row = db
        .prepare(
          `SELECT prt.email, COALESCE(u.totp_secret_enc, '') AS totp_secret_enc
           FROM password_reset_tokens prt
           LEFT JOIN users u ON u.email = prt.email
           WHERE prt.token_hash = ? AND prt.expires_at > datetime('now')`,
        )
        .get(tokenHash) as { email: string; totp_secret_enc: string } | undefined;
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
      const row = db
        .prepare(
          `SELECT prt.email, u.totp_secret_enc
           FROM password_reset_tokens prt
           LEFT JOIN users u ON u.email = prt.email
           WHERE prt.token_hash = ? AND prt.expires_at > datetime('now')`,
        )
        .get(tokenHash) as {
          email: string;
          totp_secret_enc: string | null;
        } | undefined;
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
          return reply.status(401).send({
            error: "Invalid two-factor code. Please try again.",
          });
        }
      }

      const password_hash = await argon2.hash(password);
      db.prepare("UPDATE users SET password_hash = ? WHERE email = ?").run(
        password_hash,
        row.email,
      );
      db.prepare("DELETE FROM password_reset_tokens WHERE token_hash = ?").run(
        tokenHash,
      );
      return reply.send({ ok: true });
    },
  );
}
