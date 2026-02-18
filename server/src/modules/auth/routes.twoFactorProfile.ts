import type { FastifyInstance } from "fastify";
import argon2 from "argon2";
import { nanoid } from "nanoid";
import { randomBytes } from "crypto";
import { requireAuth, requireNotReadOnly } from "../../plugins/auth.js";
import { db } from "../../db/index.js";
import { parseTwoFactorMethods, isMethodAllowed } from "@harborfm/shared";
import { readSettings } from "../settings/index.js";
import { getClientIp, getUserAgent, recordFailureAndMaybeBan } from "../../services/loginAttempts.js";
import { sendMail, build2FAAddedEmail, build2FARemovedEmail } from "../../services/email.js";
import { normalizeHostname } from "../../utils/url.js";
import { sha256Hex } from "../../utils/hash.js";
import {
  generateTotpSecret,
  verifyTotp,
  encryptTotpSecret,
  getTotpUri,
  getTotpQrDataUrl,
} from "../../services/twoFactor.js";
import { JWT_COOKIE_NAME } from "../../config.js";
import { generateSecureOtp, requireSession } from "./shared.js";

export async function registerTwoFactorProfileRoutes(app: FastifyInstance) {
  app.get(
    "/auth/me/2fa",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Auth"],
        summary: "Get 2FA status",
        response: { 200: { description: "2FA status" } },
      },
    },
    async (request, reply) => {
      if (
        !requireSession(request, reply as Parameters<typeof requireSession>[1])
      )
        return;
      const row = db
        .prepare(
          "SELECT two_factor_method, totp_secret_enc FROM users WHERE id = ?",
        )
        .get(request.userId) as {
          two_factor_method: string | null;
          totp_secret_enc: string | null;
        } | undefined;
      const methods = row?.two_factor_method?.trim() ?? null;
      return {
        hasTOTP: Boolean(row?.totp_secret_enc),
        hasEmail: methods?.includes("email") ?? false,
        methods: methods ?? null,
      };
    },
  );

  app.post(
    "/auth/me/2fa/totp/start",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Auth"],
        summary: "Start TOTP setup",
        body: {
          type: "object",
          properties: { password: { type: "string" } },
          required: ["password"],
        },
        response: {
          200: { description: "QR and secret" },
          400: { description: "Validation failed" },
          401: { description: "Invalid password" },
          403: { description: "TOTP not enabled" },
        },
      },
    },
    async (request, reply) => {
      if (
        !requireSession(request, reply as Parameters<typeof requireSession>[1])
      )
        return;
      const settings = readSettings();
      const allowedMethods = parseTwoFactorMethods(
        settings.two_factor_methods ?? "totp",
      );
      if (!isMethodAllowed(allowedMethods, "totp")) {
        return reply.status(403).send({ error: "TOTP 2FA is not enabled." });
      }
      const body = request.body as { password?: string };
      const password = body?.password;
      if (!password?.trim()) {
        return reply.status(400).send({ error: "Password is required" });
      }
      const row = db
        .prepare("SELECT id, email, password_hash FROM users WHERE id = ?")
        .get(request.userId) as
        | { id: string; email: string; password_hash: string }
        | undefined;
      if (!row || !(await argon2.verify(row.password_hash, password))) {
        return reply.status(401).send({ error: "Invalid password" });
      }
      const secret = generateTotpSecret();
      const uri = getTotpUri({ secret, label: row.email, issuer: "HarborFM" });
      const qrDataUrl = await getTotpQrDataUrl(uri);
      const tempToken = randomBytes(24).toString("base64url");
      const tokenHash = sha256Hex(tempToken);
      db.prepare(
        `INSERT INTO auth_2fa_challenges (id, user_id, token_hash, method, expires_at) VALUES (?, ?, ?, 'totp', datetime('now', '+10 minutes'))`,
      ).run(nanoid(32), row.id, tokenHash);
      return reply.send({
        qrDataUrl,
        secret,
        setupToken: tempToken,
      });
    },
  );

  app.post(
    "/auth/me/2fa/totp/confirm",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Auth"],
        summary: "Confirm TOTP setup",
        body: {
          type: "object",
          properties: {
            setupToken: { type: "string" },
            code: { type: "string" },
            secret: { type: "string" },
          },
          required: ["setupToken", "code", "secret"],
        },
        response: {
          200: { description: "OK" },
          400: { description: "Validation failed" },
          401: { description: "Invalid code" },
        },
      },
    },
    async (request, reply) => {
      if (
        !requireSession(request, reply as Parameters<typeof requireSession>[1])
      )
        return;
      const body = request.body as {
        setupToken?: string;
        code?: string;
        secret?: string;
      };
      if (!body?.setupToken || !body?.code || !body?.secret) {
        return reply
          .status(400)
          .send({
            error: "setupToken, code, and secret are required",
          });
      }
      const tokenHash = sha256Hex(body.setupToken);
      const challenge = db
        .prepare(
          `SELECT user_id FROM auth_2fa_challenges WHERE token_hash = ? AND method = 'totp' AND datetime(expires_at) > datetime('now')`,
        )
        .get(tokenHash) as { user_id: string } | undefined;
      if (!challenge || challenge.user_id !== request.userId) {
        return reply
          .status(400)
          .send({ error: "Invalid or expired setup. Please try again." });
      }
      const valid = await verifyTotp(body.secret.trim(), body.code.trim());
      if (!valid) {
        return reply.status(401).send({ error: "Invalid code" });
      }
      const secretEnc = encryptTotpSecret(body.secret.trim());
      const existing = db
        .prepare("SELECT two_factor_method FROM users WHERE id = ?")
        .get(request.userId) as { two_factor_method: string | null } | undefined;
      const currentMethods = existing?.two_factor_method?.trim() ?? "";
      const newMethods = currentMethods ? `${currentMethods},totp` : "totp";
      db.prepare(
        `UPDATE users SET totp_secret_enc = ?, two_factor_method = ? WHERE id = ?`,
      ).run(secretEnc, newMethods, request.userId);
      db.prepare("DELETE FROM auth_2fa_challenges WHERE token_hash = ?").run(
        tokenHash,
      );
      const settings = readSettings();
      if (
        settings.email_provider === "smtp" ||
        settings.email_provider === "sendgrid" ||
        settings.email_provider === "webhook"
      ) {
        const userRow = db
          .prepare("SELECT email FROM users WHERE id = ?")
          .get(request.userId) as { email: string } | undefined;
        if (userRow?.email) {
          const baseUrl =
            normalizeHostname(settings.hostname || "") || "http://localhost";
          const { subject, text, html } = build2FAAddedEmail(baseUrl, "totp");
          void sendMail({
            to: userRow.email,
            subject,
            text,
            html,
          });
        }
      }
      return reply.send({ ok: true });
    },
  );

  const twoFaEmailStartKeyGenerator = (request: {
    ip?: string;
    cookies?: Record<string, string | undefined>;
  }) => {
    const token = (
      request as { cookies?: Record<string, string | undefined> }
    ).cookies?.[JWT_COOKIE_NAME];
    if (typeof token === "string" && token.trim()) {
      return `2fa-email-start:${sha256Hex(token.trim())}`;
    }
    return `2fa-email-start:ip:${(request.ip || "").trim() || "unknown"}`;
  };

  app.post(
    "/auth/me/2fa/email/start",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      config: {
        rateLimit: {
          max: 1,
          timeWindow: "30 seconds",
          keyGenerator: twoFaEmailStartKeyGenerator,
        },
      },
      schema: {
        tags: ["Auth"],
        summary: "Send email 2FA setup code",
        response: {
          200: { description: "OK" },
          400: { description: "No email" },
          403: { description: "Email 2FA not enabled" },
          429: { description: "Rate limited (1 per 30 seconds)" },
          500: { description: "Send failed" },
          503: { description: "Email not configured" },
        },
      },
    },
    async (request, reply) => {
      if (
        !requireSession(request, reply as Parameters<typeof requireSession>[1])
      )
        return;
      const settings = readSettings();
      const allowedMethods = parseTwoFactorMethods(
        settings.two_factor_methods ?? "totp",
      );
      if (!isMethodAllowed(allowedMethods, "email")) {
        return reply
          .status(403)
          .send({ error: "Email 2FA is not enabled." });
      }
      if (
        settings.email_provider !== "smtp" &&
        settings.email_provider !== "sendgrid" &&
        settings.email_provider !== "webhook"
      ) {
        return reply.status(503).send({ error: "Email is not configured" });
      }
      const row = db
        .prepare("SELECT email FROM users WHERE id = ?")
        .get(request.userId) as { email: string } | undefined;
      if (!row?.email) {
        return reply.status(400).send({ error: "No email on account" });
      }
      db.prepare("DELETE FROM user_otp_codes WHERE user_id = ?").run(
        request.userId,
      );
      const code = generateSecureOtp();
      const codeHash = sha256Hex(code);
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      db.prepare(
        `INSERT INTO user_otp_codes (user_id, code_hash, expires_at) VALUES (?, ?, ?)`,
      ).run(request.userId, codeHash, expiresAt);
      const { build2FAEmailCodeEmail } = await import("../../services/email.js");
      const baseUrl =
        normalizeHostname(settings.hostname || "") || "http://localhost";
      const { subject, text, html } = build2FAEmailCodeEmail(baseUrl, code);
      const sendResult = await sendMail({
        to: row.email,
        subject,
        text,
        html,
      });
      if (!sendResult.sent) {
        return reply
          .status(500)
          .send({ error: sendResult.error ?? "Failed to send email" });
      }
      return reply.send({ ok: true });
    },
  );

  const twoFaEmailConfirmKeyGenerator = (request: {
    cookies?: Record<string, string | undefined>;
    ip?: string;
  }) => {
    const token = (
      request as { cookies?: Record<string, string | undefined> }
    ).cookies?.[JWT_COOKIE_NAME];
    if (typeof token === "string" && token.trim()) {
      return `2fa-email-confirm:${sha256Hex(token.trim())}`;
    }
    return `2fa-email-confirm:ip:${(request.ip || "").trim() || "unknown"}`;
  };

  app.post(
    "/auth/me/2fa/email/confirm",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      config: {
        rateLimit: {
          max: 5,
          timeWindow: "1 minute",
          keyGenerator: twoFaEmailConfirmKeyGenerator,
        },
      },
      schema: {
        tags: ["Auth"],
        summary: "Confirm email 2FA",
        body: {
          type: "object",
          properties: { code: { type: "string" } },
          required: ["code"],
        },
        response: {
          200: { description: "OK" },
          400: { description: "Validation failed" },
          401: { description: "Invalid code" },
          429: { description: "Rate limited or locked" },
        },
      },
    },
    async (request, reply) => {
      if (
        !requireSession(request, reply as Parameters<typeof requireSession>[1])
      )
        return;
      const lockedRow = db
        .prepare("SELECT totp_locked_until FROM users WHERE id = ?")
        .get(request.userId) as {
          totp_locked_until: string | null;
        } | undefined;
      if (
        lockedRow?.totp_locked_until &&
        new Date(lockedRow.totp_locked_until) > new Date()
      ) {
        const retrySec = Math.ceil(
          (new Date(lockedRow.totp_locked_until).getTime() - Date.now()) / 1000,
        );
        return reply
          .status(429)
          .header("Retry-After", String(Math.max(1, retrySec)))
          .send({ error: "Too many failed attempts. Please try again later." });
      }
      const body = request.body as { code?: string };
      const code = body?.code?.trim();
      if (!code) {
        return reply.status(400).send({ error: "Code is required" });
      }
      const codeHash = sha256Hex(code);
      const otpRow = db
        .prepare(
          `SELECT id FROM user_otp_codes WHERE user_id = ? AND code_hash = ? AND datetime(expires_at) > datetime('now')`,
        )
        .get(request.userId, codeHash) as { id: number } | undefined;
      if (!otpRow) {
        const ip = getClientIp(request);
        db.prepare(
          "INSERT INTO user_totp_attempts (user_id, created_at) VALUES (?, datetime('now'))",
        ).run(request.userId);
        const countRow = db
          .prepare(
            `SELECT COUNT(*) as cnt FROM user_totp_attempts WHERE user_id = ? AND datetime(created_at) >= datetime('now', '-15 minutes')`,
          )
          .get(request.userId) as { cnt: number };
        const failures = Number(countRow?.cnt ?? 0);
        if (failures >= 5) {
          db.prepare(
            `UPDATE users SET totp_locked_until = datetime('now', '+15 minutes') WHERE id = ?`,
          ).run(request.userId);
          recordFailureAndMaybeBan(ip, "auth_totp", {
            userAgent: getUserAgent(request),
          });
          return reply
            .status(429)
            .header("Retry-After", "900")
            .send({
              error: "Too many failed attempts. Please try again in 15 minutes.",
            });
        }
        return reply.status(401).send({ error: "Invalid or expired code" });
      }
      db.prepare("DELETE FROM user_otp_codes WHERE id = ?").run(otpRow.id);
      db.prepare("DELETE FROM user_totp_attempts WHERE user_id = ?").run(
        request.userId,
      );
      const existing = db
        .prepare("SELECT two_factor_method FROM users WHERE id = ?")
        .get(request.userId) as { two_factor_method: string | null } | undefined;
      const currentMethods = existing?.two_factor_method?.trim() ?? "";
      const newMethods = currentMethods ? `${currentMethods},email` : "email";
      db.prepare(`UPDATE users SET two_factor_method = ? WHERE id = ?`).run(
        newMethods,
        request.userId,
      );
      const settings = readSettings();
      if (
        settings.email_provider === "smtp" ||
        settings.email_provider === "sendgrid" ||
        settings.email_provider === "webhook"
      ) {
        const userRow = db
          .prepare("SELECT email FROM users WHERE id = ?")
          .get(request.userId) as { email: string } | undefined;
        if (userRow?.email) {
          const baseUrl =
            normalizeHostname(settings.hostname || "") || "http://localhost";
          const { subject, text, html } = build2FAAddedEmail(
            baseUrl,
            "email",
          );
          void sendMail({
            to: userRow.email,
            subject,
            text,
            html,
          });
        }
      }
      return reply.send({ ok: true });
    },
  );

  app.post(
    "/auth/me/2fa/disable",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Auth"],
        summary: "Disable 2FA",
        body: {
          type: "object",
          properties: { password: { type: "string" } },
          required: ["password"],
        },
        response: {
          200: { description: "OK" },
          400: { description: "Validation failed" },
          401: { description: "Invalid password" },
          403: { description: "2FA enforced" },
        },
      },
    },
    async (request, reply) => {
      if (
        !requireSession(request, reply as Parameters<typeof requireSession>[1])
      )
        return;
      const settings = readSettings();
      if (settings.two_factor_enabled && settings.two_factor_enforced) {
        return reply.status(403).send({
          error:
            "2FA is enforced by the administrator. You cannot disable it.",
        });
      }
      const body = request.body as { password?: string };
      const password = body?.password;
      if (!password?.trim()) {
        return reply.status(400).send({ error: "Password is required" });
      }
      const row = db
        .prepare("SELECT password_hash, email FROM users WHERE id = ?")
        .get(request.userId) as
        | { password_hash: string; email: string }
        | undefined;
      if (!row || !(await argon2.verify(row.password_hash, password))) {
        return reply.status(401).send({ error: "Invalid password" });
      }
      db.prepare(
        `UPDATE users SET totp_secret_enc = NULL, two_factor_method = NULL, totp_locked_until = NULL WHERE id = ?`,
      ).run(request.userId);
      db.prepare("DELETE FROM user_totp_attempts WHERE user_id = ?").run(
        request.userId,
      );
      if (
        settings.email_provider === "smtp" ||
        settings.email_provider === "sendgrid" ||
        settings.email_provider === "webhook"
      ) {
        if (row.email) {
          const baseUrl =
            normalizeHostname(settings.hostname || "") || "http://localhost";
          const { subject, text, html } = build2FARemovedEmail(baseUrl);
          void sendMail({ to: row.email, subject, text, html });
        }
      }
      return reply.send({ ok: true });
    },
  );
}
