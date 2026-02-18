import type { FastifyInstance } from "fastify";
import { db } from "../../db/index.js";
import {
  verify2FABodySchema,
  send2FAEmailCodeBodySchema,
  setup2FABodySchema,
  confirm2FASetupBodySchema,
  parseTwoFactorMethods,
  isMethodAllowed,
} from "@harborfm/shared";
import { readSettings } from "../settings/index.js";
import {
  getClientIp,
  getIpBan,
  getUserAgent,
  recordFailureAndMaybeBan,
} from "../../services/loginAttempts.js";
import { sendMail, build2FAAddedEmail } from "../../services/email.js";
import { normalizeHostname } from "../../utils/url.js";
import { sha256Hex } from "../../utils/hash.js";
import {
  generateTotpSecret,
  verifyTotp,
  encryptTotpSecret,
  decryptTotpSecret,
  getTotpUri,
  getTotpQrDataUrl,
} from "../../services/twoFactor.js";
import { CSRF_COOKIE_NAME, JWT_COOKIE_NAME } from "../../config.js";
import { COOKIE_OPTS, CSRF_COOKIE_OPTS, generateSecureOtp, newCsrfToken } from "./shared.js";

export async function registerTwoFactorLoginRoutes(app: FastifyInstance) {
  const twoFaVerifyKeyGenerator = (request: { body?: unknown; ip?: string }) => {
    const body = request.body as { challengeToken?: string } | undefined;
    const token = body?.challengeToken;
    if (typeof token === "string" && token.trim()) {
      return `2fa-verify:${token.trim()}`;
    }
    return `2fa-verify:ip:${(request.ip || "").trim() || "unknown"}`;
  };

  app.post(
    "/auth/2fa/verify",
    {
      config: {
        rateLimit: {
          max: 1,
          timeWindow: "30 seconds",
          keyGenerator: twoFaVerifyKeyGenerator,
        },
      },
      schema: {
        tags: ["Auth"],
        summary: "Verify 2FA code",
        description: "Verify TOTP or email OTP after successful password login.",
        security: [],
        body: {
          type: "object",
          properties: {
            challengeToken: { type: "string" },
            code: { type: "string" },
          },
          required: ["challengeToken", "code"],
        },
        response: {
          200: { description: "User and session" },
          400: { description: "Invalid or expired challenge" },
          401: { description: "Invalid code" },
          429: { description: "Rate limited or locked" },
        },
      },
    },
    async (request, reply) => {
      const ip = getClientIp(request);
      const ban = getIpBan(ip, "auth_totp");
      if (ban.banned) {
        return reply
          .status(429)
          .header("Retry-After", String(ban.retryAfterSec))
          .send({
            error: "Too many failed attempts. Try again in a few minutes.",
          });
      }

      const parsed = verify2FABodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "Validation failed",
          details: parsed.error.flatten(),
        });
      }
      const { challengeToken, code } = parsed.data;
      const tokenHash = sha256Hex(challengeToken);

      const challenge = db
        .prepare(
          `SELECT c.user_id, c.method, u.email, u.totp_secret_enc, u.totp_locked_until FROM auth_2fa_challenges c
         INNER JOIN users u ON u.id = c.user_id
         WHERE c.token_hash = ? AND datetime(c.expires_at) > datetime('now')`,
        )
        .get(tokenHash) as
        | {
            user_id: string;
            method: string;
            email: string;
            totp_secret_enc: string | null;
            totp_locked_until: string | null;
          }
        | undefined;

      if (!challenge) {
        return reply
          .status(400)
          .send({ error: "Invalid or expired challenge. Please sign in again." });
      }

      if (
        challenge.totp_locked_until &&
        new Date(challenge.totp_locked_until) > new Date()
      ) {
        const retrySec = Math.ceil(
          (new Date(challenge.totp_locked_until).getTime() - Date.now()) / 1000,
        );
        return reply
          .status(429)
          .header("Retry-After", String(Math.max(1, retrySec)))
          .send({
            error: "Too many failed attempts. Please try again later.",
          });
      }

      let valid = false;

      if (challenge.method === "totp" && challenge.totp_secret_enc) {
        let secret: string;
        try {
          secret = decryptTotpSecret(challenge.totp_secret_enc);
        } catch {
          return reply.status(401).send({ error: "Invalid code" });
        }
        valid = await verifyTotp(secret, code);
      } else if (challenge.method === "email") {
        const codeHash = sha256Hex(code.trim());
        const row = db
          .prepare(
            `SELECT id FROM user_otp_codes WHERE user_id = ? AND code_hash = ? AND datetime(expires_at) > datetime('now')`,
          )
          .get(challenge.user_id, codeHash) as { id: number } | undefined;
        if (row) {
          valid = true;
          db.prepare("DELETE FROM user_otp_codes WHERE id = ?").run(row.id);
        }
      }

      if (!valid) {
        const ip = getClientIp(request);
        db.prepare(
          "INSERT INTO user_totp_attempts (user_id, created_at) VALUES (?, datetime('now'))",
        ).run(challenge.user_id);
        const countRow = db
          .prepare(
            `SELECT COUNT(*) as cnt FROM user_totp_attempts WHERE user_id = ? AND datetime(created_at) >= datetime('now', '-15 minutes')`,
          )
          .get(challenge.user_id) as { cnt: number };
        const failures = Number(countRow?.cnt ?? 0);
        if (failures >= 5) {
          db.prepare(
            `UPDATE users SET totp_locked_until = datetime('now', '+15 minutes') WHERE id = ?`,
          ).run(challenge.user_id);
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
        return reply.status(401).send({ error: "Invalid code" });
      }

      db.prepare("DELETE FROM auth_2fa_challenges WHERE token_hash = ?").run(
        tokenHash,
      );
      db.prepare("DELETE FROM user_totp_attempts WHERE user_id = ?").run(
        challenge.user_id,
      );

      const token = app.jwt.sign(
        { sub: challenge.user_id, email: challenge.email },
        { expiresIn: "7d" },
      );
      return reply
        .setCookie(JWT_COOKIE_NAME, token, COOKIE_OPTS)
        .setCookie(CSRF_COOKIE_NAME, newCsrfToken(), CSRF_COOKIE_OPTS)
        .send({ user: { id: challenge.user_id, email: challenge.email } });
    },
  );

  const twoFaSendEmailCodeKeyGenerator = (request: {
    body?: unknown;
    ip?: string;
  }) => {
    const body = request.body as { challengeToken?: string } | undefined;
    const token = body?.challengeToken;
    if (typeof token === "string" && token.trim()) {
      return `2fa-send-email:${sha256Hex(token.trim())}`;
    }
    return `2fa-send-email:ip:${(request.ip || "").trim() || "unknown"}`;
  };

  app.post(
    "/auth/2fa/send-email-code",
    {
      config: {
        rateLimit: {
          max: 1,
          timeWindow: "30 seconds",
          keyGenerator: twoFaSendEmailCodeKeyGenerator,
        },
      },
      schema: {
        tags: ["Auth"],
        summary: "Send 2FA email code",
        description:
          "Send a one-time code to the user's email. Requires valid challenge. Limited to 1 per 30 seconds.",
        security: [],
        body: {
          type: "object",
          properties: { challengeToken: { type: "string" } },
          required: ["challengeToken"],
        },
        response: {
          200: { description: "OK" },
          400: { description: "Invalid challenge or email not configured" },
          429: { description: "Rate limited" },
          500: { description: "Failed to send email" },
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
        return reply
          .status(400)
          .send({
            error: "Email 2FA is not available. No email service configured.",
          });
      }

      const parsed = send2FAEmailCodeBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Validation failed" });
      }
      const { challengeToken } = parsed.data;
      const tokenHash = sha256Hex(challengeToken);

      const challenge = db
        .prepare(
          `SELECT c.user_id, c.method, u.email FROM auth_2fa_challenges c
         INNER JOIN users u ON u.id = c.user_id
         WHERE c.token_hash = ? AND datetime(c.expires_at) > datetime('now')`,
        )
        .get(tokenHash) as
        | { user_id: string; method: string; email: string }
        | undefined;

      if (!challenge || challenge.method !== "email") {
        return reply
          .status(400)
          .send({ error: "Invalid or expired challenge." });
      }

      db.prepare("DELETE FROM user_otp_codes WHERE user_id = ?").run(
        challenge.user_id,
      );
      const otpCode = generateSecureOtp();
      const codeHash = sha256Hex(otpCode);
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      db.prepare(
        `INSERT INTO user_otp_codes (user_id, code_hash, expires_at) VALUES (?, ?, ?)`,
      ).run(challenge.user_id, codeHash, expiresAt);

      const { build2FAEmailCodeEmail } = await import("../../services/email.js");
      const baseUrl =
        normalizeHostname(settings.hostname || "") || "http://localhost";
      const { subject, text, html } = build2FAEmailCodeEmail(baseUrl, otpCode);
      const sendResult = await sendMail({
        to: challenge.email,
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

  const twoFaSetupKeyGenerator = (request: {
    body?: unknown;
    ip?: string;
  }) => {
    const body = request.body as {
      challengeToken?: string;
      method?: string;
    } | undefined;
    const token = body?.challengeToken;
    const method = body?.method;
    if (method === "email" && typeof token === "string" && token.trim()) {
      return `2fa-send-email:${sha256Hex(token.trim())}`;
    }
    return `2fa-setup:${
      typeof token === "string" && token.trim()
        ? sha256Hex(token.trim())
        : (request.ip || "").trim() || "unknown"
    }`;
  };

  app.post(
    "/auth/2fa/setup",
    {
      config: {
        rateLimit: {
          max: 1,
          timeWindow: "30 seconds",
          keyGenerator: twoFaSetupKeyGenerator,
        },
      },
      schema: {
        tags: ["Auth"],
        summary: "Start 2FA setup",
        description:
          "For users who must add 2FA when enforced. Returns QR for TOTP or triggers email. Email limited to 1 per 30 seconds.",
        security: [],
        body: {
          type: "object",
          properties: {
            challengeToken: { type: "string" },
            method: { type: "string", enum: ["totp", "email"] },
          },
          required: ["challengeToken", "method"],
        },
        response: {
          200: { description: "QR data or ok" },
          400: { description: "Invalid challenge" },
          403: { description: "Read-only account" },
          429: { description: "Rate limited (email: 1 per 30 seconds)" },
        },
      },
    },
    async (request, reply) => {
      const parsed = setup2FABodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Validation failed" });
      }
      const { challengeToken, method } = parsed.data;
      const tokenHash = sha256Hex(challengeToken);

      const challenge = db
        .prepare(
          `SELECT c.id, c.user_id, u.email, COALESCE(u.read_only, 0) as read_only FROM auth_2fa_challenges c
         INNER JOIN users u ON u.id = c.user_id
         WHERE c.token_hash = ? AND datetime(c.expires_at) > datetime('now')`,
        )
        .get(tokenHash) as
        | { id: string; user_id: string; email: string; read_only: number }
        | undefined;

      if (!challenge) {
        return reply
          .status(400)
          .send({ error: "Invalid or expired challenge. Please sign in again." });
      }
      if (challenge.read_only === 1) {
        return reply.status(403).send({
          error:
            "Read-only accounts cannot add or remove two-factor authentication.",
        });
      }
      const settings = readSettings();
      const allowedMethods = parseTwoFactorMethods(
        settings.two_factor_methods ?? "totp",
      );
      if (!isMethodAllowed(allowedMethods, method)) {
        return reply
          .status(403)
          .send({ error: `${method} 2FA is not enabled.` });
      }

      if (method === "totp") {
        const secret = generateTotpSecret();
        const uri = getTotpUri({
          secret,
          label: challenge.email,
          issuer: "HarborFM",
        });
        const qrDataUrl = await getTotpQrDataUrl(uri);
        return reply.send({
          qrDataUrl,
          secret,
          challengeToken,
        });
      }

      if (method === "email") {
        if (
          settings.email_provider !== "smtp" &&
          settings.email_provider !== "sendgrid" &&
          settings.email_provider !== "webhook"
        ) {
          return reply
            .status(400)
            .send({
              error:
                "Email 2FA is not available. Configure an email provider in Settings.",
            });
        }
        db.prepare("DELETE FROM user_otp_codes WHERE user_id = ?").run(
          challenge.user_id,
        );
        const otpCode = generateSecureOtp();
        const codeHash = sha256Hex(otpCode);
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
        db.prepare(
          `INSERT INTO user_otp_codes (user_id, code_hash, expires_at) VALUES (?, ?, ?)`,
        ).run(challenge.user_id, codeHash, expiresAt);
        const { build2FAEmailCodeEmail } = await import(
          "../../services/email.js"
        );
        const baseUrl =
          normalizeHostname(settings.hostname || "") || "http://localhost";
        const { subject, text, html } = build2FAEmailCodeEmail(
          baseUrl,
          otpCode,
        );
        await sendMail({ to: challenge.email, subject, text, html });
        return reply.send({ ok: true, challengeToken });
      }

      return reply.status(400).send({ error: "Invalid method" });
    },
  );

  const twoFaConfirmSetupKeyGenerator = (request: {
    body?: unknown;
    ip?: string;
  }) => {
    const body = request.body as { challengeToken?: string } | undefined;
    const token = body?.challengeToken;
    if (typeof token === "string" && token.trim()) {
      return `2fa-confirm-setup:${sha256Hex(token.trim())}`;
    }
    return `2fa-confirm-setup:ip:${(request.ip || "").trim() || "unknown"}`;
  };

  app.post(
    "/auth/2fa/confirm-setup",
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: "1 minute",
          keyGenerator: twoFaConfirmSetupKeyGenerator,
        },
      },
      schema: {
        tags: ["Auth"],
        summary: "Confirm 2FA setup",
        description:
          "Verify code and save 2FA. Issues JWT on success. Rate limited to 5 attempts per minute.",
        security: [],
        body: {
          type: "object",
          properties: {
            challengeToken: { type: "string" },
            code: { type: "string" },
          },
          required: ["challengeToken", "code"],
        },
        response: {
          200: { description: "User and session" },
          400: { description: "Invalid" },
          401: { description: "Invalid code" },
          403: { description: "Read-only account" },
          429: { description: "Rate limited or locked" },
        },
      },
    },
    async (request, reply) => {
      const parsed = confirm2FASetupBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Validation failed" });
      }
      const { challengeToken, code } = parsed.data;
      const tokenHash = sha256Hex(challengeToken);

      const challenge = db
        .prepare(
          `SELECT c.id, c.user_id, u.email, COALESCE(u.read_only, 0) as read_only, u.totp_locked_until
         FROM auth_2fa_challenges c
         INNER JOIN users u ON u.id = c.user_id
         WHERE c.token_hash = ? AND datetime(c.expires_at) > datetime('now')`,
        )
        .get(tokenHash) as {
          id: string;
          user_id: string;
          email: string;
          read_only: number;
          totp_locked_until: string | null;
        } | undefined;

      if (!challenge) {
        return reply
          .status(400)
          .send({ error: "Invalid or expired challenge. Please sign in again." });
      }
      if (challenge.read_only === 1) {
        return reply.status(403).send({
          error:
            "Read-only accounts cannot add or remove two-factor authentication.",
        });
      }
      if (
        challenge.totp_locked_until &&
        new Date(challenge.totp_locked_until) > new Date()
      ) {
        const retrySec = Math.ceil(
          (new Date(challenge.totp_locked_until).getTime() - Date.now()) / 1000,
        );
        return reply
          .status(429)
          .header("Retry-After", String(Math.max(1, retrySec)))
          .send({ error: "Too many failed attempts. Please try again later." });
      }

      const body = request.body as { secret?: string };
      const hasSecret = typeof body?.secret === "string" && body.secret.trim();

      if (hasSecret) {
        const valid = await verifyTotp(body.secret!.trim(), code);
        if (!valid) {
          return reply.status(401).send({ error: "Invalid code" });
        }
        const totpChallenge = db
          .prepare(
            `SELECT c.id, c.user_id, u.email FROM auth_2fa_challenges c
           INNER JOIN users u ON u.id = c.user_id
           WHERE c.token_hash = ? AND datetime(c.expires_at) > datetime('now')`,
          )
          .get(tokenHash) as
          | { id: string; user_id: string; email: string }
          | undefined;
        if (!totpChallenge) {
          return reply
            .status(400)
            .send({
              error: "Invalid or expired challenge. Please sign in again.",
            });
        }
        const secretEnc = encryptTotpSecret(body.secret!.trim());
        db.prepare(
          `UPDATE users SET totp_secret_enc = ?, two_factor_method = ? WHERE id = ?`,
        ).run(secretEnc, "totp", totpChallenge.user_id);
        db.prepare("DELETE FROM auth_2fa_challenges WHERE id = ?").run(
          totpChallenge.id,
        );
        const totpSettings = readSettings();
        if (
          totpSettings.email_provider === "smtp" ||
          totpSettings.email_provider === "sendgrid" ||
          totpSettings.email_provider === "webhook"
        ) {
          const baseUrl =
            normalizeHostname(totpSettings.hostname || "") || "http://localhost";
          const { subject, text, html } = build2FAAddedEmail(baseUrl, "totp");
          void sendMail({
            to: totpChallenge.email,
            subject,
            text,
            html,
          });
        }
        const token = app.jwt.sign(
          { sub: totpChallenge.user_id, email: totpChallenge.email },
          { expiresIn: "7d" },
        );
        return reply
          .setCookie(JWT_COOKIE_NAME, token, COOKIE_OPTS)
          .setCookie(CSRF_COOKIE_NAME, newCsrfToken(), CSRF_COOKIE_OPTS)
          .send({
            user: {
              id: totpChallenge.user_id,
              email: totpChallenge.email,
            },
          });
      }

      const emailChallenge = db
        .prepare(
          `SELECT c.id, c.user_id, u.email FROM auth_2fa_challenges c
         INNER JOIN users u ON u.id = c.user_id
         WHERE c.token_hash = ? AND datetime(c.expires_at) > datetime('now')`,
        )
        .get(tokenHash) as
        | { id: string; user_id: string; email: string }
        | undefined;
      if (!emailChallenge) {
        return reply
          .status(400)
          .send({ error: "Invalid or expired challenge." });
      }
      const otpRow = db
        .prepare(
          `SELECT id FROM user_otp_codes WHERE user_id = ? AND code_hash = ? AND datetime(expires_at) > datetime('now')`,
        )
        .get(
          emailChallenge.user_id,
          sha256Hex(code.trim()),
        ) as { id: number } | undefined;
      if (!otpRow) {
        const ip = getClientIp(request);
        db.prepare(
          "INSERT INTO user_totp_attempts (user_id, created_at) VALUES (?, datetime('now'))",
        ).run(emailChallenge.user_id);
        const countRow = db
          .prepare(
            `SELECT COUNT(*) as cnt FROM user_totp_attempts WHERE user_id = ? AND datetime(created_at) >= datetime('now', '-15 minutes')`,
          )
          .get(emailChallenge.user_id) as { cnt: number };
        const failures = Number(countRow?.cnt ?? 0);
        if (failures >= 5) {
          db.prepare(
            `UPDATE users SET totp_locked_until = datetime('now', '+15 minutes') WHERE id = ?`,
          ).run(emailChallenge.user_id);
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
        return reply.status(401).send({ error: "Invalid code" });
      }
      db.prepare("DELETE FROM user_otp_codes WHERE id = ?").run(otpRow.id);
      db.prepare("DELETE FROM user_totp_attempts WHERE user_id = ?").run(
        emailChallenge.user_id,
      );
      db.prepare(
        `UPDATE users SET two_factor_method = ? WHERE id = ?`,
      ).run("email", emailChallenge.user_id);
      db.prepare("DELETE FROM auth_2fa_challenges WHERE id = ?").run(
        emailChallenge.id,
      );
      const emailSettings = readSettings();
      if (
        emailSettings.email_provider === "smtp" ||
        emailSettings.email_provider === "sendgrid" ||
        emailSettings.email_provider === "webhook"
      ) {
        const baseUrl =
          normalizeHostname(emailSettings.hostname || "") || "http://localhost";
        const { subject, text, html } = build2FAAddedEmail(baseUrl, "email");
        void sendMail({
          to: emailChallenge.email,
          subject,
          text,
          html,
        });
      }
      const token = app.jwt.sign(
        { sub: emailChallenge.user_id, email: emailChallenge.email },
        { expiresIn: "7d" },
      );
      return reply
        .setCookie(JWT_COOKIE_NAME, token, COOKIE_OPTS)
        .setCookie(CSRF_COOKIE_NAME, newCsrfToken(), CSRF_COOKIE_OPTS)
        .send({
          user: {
            id: emailChallenge.user_id,
            email: emailChallenge.email,
          },
        });
    },
  );
}
