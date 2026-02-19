import type { FastifyInstance } from "fastify";
import argon2 from "argon2";
import { nanoid } from "nanoid";
import { randomBytes } from "crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import { requireAuth, requireNotReadOnly } from "../../plugins/auth.js";
import { drizzleDb } from "../../db/index.js";
import {
  auth2faChallenges,
  userOtpCodes,
  userTotpAttempts,
  users,
} from "../../db/schema.js";
import {
  parseTwoFactorMethods,
  isMethodAllowed,
  totpConfirmBodySchema,
  twoFactorDisableBodySchema,
  verify2FABodySchema,
} from "@harborfm/shared";
import { readSettings, isEmailProviderConfigured } from "../settings/index.js";
import {
  getClientIp,
  getIpBan,
  getUserAgent,
  recordTOTPFailureAndCheckLockout,
} from "../../services/loginAttempts.js";
import { sendMail, build2FAAddedEmail, build2FARemovedEmail } from "../../services/email.js";
import { getBaseUrl } from "./shared.js";
import { sha256Hex } from "../../utils/hash.js";
import {
  generateTotpSecret,
  verifyTotp,
  encryptTotpSecret,
  decryptTotpSecret,
  getTotpUri,
  getTotpQrDataUrl,
} from "../../services/twoFactor.js";
import {
  JWT_COOKIE_NAME,
  AUTH_CHALLENGE_TOKEN_BYTES,
  AUTH_2FA_CHALLENGE_EXPIRY_MS,
} from "../../config.js";
import { generateSecureOtp, requireSession } from "./shared.js";
import { parseDatetimeToMs } from "../../utils/datetime.js";

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
      const row = drizzleDb
        .select({
          twoFactorMethod: users.twoFactorMethod,
          totpSecretEnc: users.totpSecretEnc,
        })
        .from(users)
        .where(eq(users.id, request.userId))
        .limit(1)
        .get();
      const methods = row?.twoFactorMethod?.trim() ?? null;
      return {
        hasTOTP: Boolean(row?.totpSecretEnc),
        hasEmail: methods?.includes("email") ?? false,
        methods: methods ?? null,
      };
    },
  );

  const twoFaTotpStartKeyGenerator = (request: {
    cookies?: Record<string, string | undefined>;
    ip?: string;
  }) => {
    const token = (
      request as { cookies?: Record<string, string | undefined> }
    ).cookies?.[JWT_COOKIE_NAME];
    if (typeof token === "string" && token.trim()) {
      return `2fa-totp-start:${sha256Hex(token.trim())}`;
    }
    return `2fa-totp-start:ip:${(request.ip || "").trim() || "unknown"}`;
  };

  app.post(
    "/auth/me/2fa/totp/start",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      config: {
        rateLimit: {
          max: 1,
          timeWindow: "30 seconds",
          keyGenerator: twoFaTotpStartKeyGenerator,
        },
      },
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
      const parsed = twoFactorDisableBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: parsed.error.issues[0]?.message ?? "Validation failed", details: parsed.error.flatten() });
      }
      const password = parsed.data.password;
      if (!password?.trim()) {
        return reply.status(400).send({ error: "Password is required" });
      }
      const row = drizzleDb
        .select({ id: users.id, email: users.email, passwordHash: users.passwordHash })
        .from(users)
        .where(eq(users.id, request.userId))
        .limit(1)
        .get();
      if (!row || !row.passwordHash || !(await argon2.verify(row.passwordHash, password))) {
        return reply.status(401).send({ error: "Invalid password" });
      }
      const secret = generateTotpSecret();
      const uri = getTotpUri({ secret, label: row.email ?? "", issuer: "HarborFM" });
      const qrDataUrl = await getTotpQrDataUrl(uri);
      const tempToken = randomBytes(AUTH_CHALLENGE_TOKEN_BYTES).toString("base64url");
      const tokenHash = sha256Hex(tempToken);
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      drizzleDb.insert(auth2faChallenges).values({
        id: nanoid(32),
        userId: row.id,
        tokenHash,
        method: "totp",
        expiresAt,
      }).run();
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
      const parsed = totpConfirmBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({
            error: "Validation failed",
            details: parsed.error.flatten(),
          });
      }
      const { setupToken, code, secret } = parsed.data;
      const tokenHash = sha256Hex(setupToken);
      const challenge = drizzleDb
        .select({ userId: auth2faChallenges.userId })
        .from(auth2faChallenges)
        .where(
          and(
            eq(auth2faChallenges.tokenHash, tokenHash),
            eq(auth2faChallenges.method, "totp"),
            gt(auth2faChallenges.expiresAt, sql`datetime('now')`),
          ),
        )
        .limit(1)
        .get();
      if (!challenge || challenge.userId !== request.userId) {
        return reply
          .status(400)
          .send({ error: "Invalid or expired setup. Please try again." });
      }
      const valid = await verifyTotp(secret.trim(), code.trim());
      if (!valid) {
        return reply.status(401).send({ error: "Invalid code" });
      }
      const secretEnc = encryptTotpSecret(secret.trim());
      const existing = drizzleDb
        .select({ twoFactorMethod: users.twoFactorMethod })
        .from(users)
        .where(eq(users.id, request.userId))
        .limit(1)
        .get();
      const currentMethods = existing?.twoFactorMethod?.trim() ?? "";
      const newMethods = currentMethods ? `${currentMethods},totp` : "totp";
      drizzleDb
        .update(users)
        .set({ totpSecretEnc: secretEnc, twoFactorMethod: newMethods })
        .where(eq(users.id, request.userId))
        .run();
      drizzleDb
        .delete(auth2faChallenges)
        .where(eq(auth2faChallenges.tokenHash, tokenHash))
        .run();
      const settings = readSettings();
      if (
        isEmailProviderConfigured(settings)
      ) {
        const userRow = drizzleDb
          .select({ email: users.email })
          .from(users)
          .where(eq(users.id, request.userId))
          .limit(1)
          .get();
        if (userRow?.email) {
          const baseUrl =
            getBaseUrl(settings);
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
        !isEmailProviderConfigured(settings)
      ) {
        return reply.status(503).send({ error: "Email is not configured" });
      }
      const row = drizzleDb
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, request.userId))
        .limit(1)
        .get();
      if (!row?.email) {
        return reply.status(400).send({ error: "No email on account" });
      }
      drizzleDb
        .delete(userOtpCodes)
        .where(eq(userOtpCodes.userId, request.userId))
        .run();
      const code = generateSecureOtp();
      const codeHash = sha256Hex(code);
      const expiresAt = new Date(
        Date.now() + AUTH_2FA_CHALLENGE_EXPIRY_MS,
      ).toISOString();
      drizzleDb.insert(userOtpCodes).values({
        userId: request.userId,
        codeHash,
        expiresAt,
      }).run();
      const { build2FAEmailCodeEmail } = await import("../../services/email.js");
      const baseUrl =
        getBaseUrl(settings);
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

  const twoFaDisableKeyGenerator = (request: {
    cookies?: Record<string, string | undefined>;
    ip?: string;
  }) => {
    const token = (
      request as { cookies?: Record<string, string | undefined> }
    ).cookies?.[JWT_COOKIE_NAME];
    if (typeof token === "string" && token.trim()) {
      return `2fa-disable:${sha256Hex(token.trim())}`;
    }
    return `2fa-disable:ip:${(request.ip || "").trim() || "unknown"}`;
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
      const lockedRow = drizzleDb
        .select({ totpLockedUntil: users.totpLockedUntil })
        .from(users)
        .where(eq(users.id, request.userId))
        .limit(1)
        .get();
      const lockedMs = parseDatetimeToMs(lockedRow?.totpLockedUntil);
      if (
        lockedRow?.totpLockedUntil &&
        !Number.isNaN(lockedMs) &&
        lockedMs > Date.now()
      ) {
        const retrySec = Math.ceil((lockedMs - Date.now()) / 1000);
        return reply
          .status(429)
          .header("Retry-After", String(Math.max(1, retrySec)))
          .send({ error: "Too many failed attempts. Please try again later." });
      }
      const parsed = verify2FABodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: parsed.error.issues[0]?.message ?? "Validation failed", details: parsed.error.flatten() });
      }
      const code = parsed.data.code?.trim();
      if (!code) {
        return reply.status(400).send({ error: "Code is required" });
      }
      const codeHash = sha256Hex(code);
      const otpRow = drizzleDb
        .select({ id: userOtpCodes.id })
        .from(userOtpCodes)
        .where(
          and(
            eq(userOtpCodes.userId, request.userId),
            eq(userOtpCodes.codeHash, codeHash),
            gt(userOtpCodes.expiresAt, sql`datetime('now')`),
          ),
        )
        .limit(1)
        .get();
      if (!otpRow) {
        const result = recordTOTPFailureAndCheckLockout(
          request.userId,
          getClientIp(request),
          getUserAgent(request),
        );
        if (result.locked) {
          return reply
            .status(429)
            .header("Retry-After", String(result.retryAfterSec ?? 900))
            .send({
              error: "Too many failed attempts. Please try again in 15 minutes.",
            });
        }
        return reply.status(401).send({ error: "Invalid or expired code" });
      }
      drizzleDb
        .delete(userOtpCodes)
        .where(eq(userOtpCodes.id, otpRow.id))
        .run();
      drizzleDb
        .delete(userTotpAttempts)
        .where(eq(userTotpAttempts.userId, request.userId))
        .run();
      const existing = drizzleDb
        .select({ twoFactorMethod: users.twoFactorMethod })
        .from(users)
        .where(eq(users.id, request.userId))
        .limit(1)
        .get();
      const currentMethods = existing?.twoFactorMethod?.trim() ?? "";
      const newMethods = currentMethods ? `${currentMethods},email` : "email";
      drizzleDb
        .update(users)
        .set({ twoFactorMethod: newMethods })
        .where(eq(users.id, request.userId))
        .run();
      const settings = readSettings();
      if (
        isEmailProviderConfigured(settings)
      ) {
        const userRow = drizzleDb
          .select({ email: users.email })
          .from(users)
          .where(eq(users.id, request.userId))
          .limit(1)
          .get();
        if (userRow?.email) {
          const baseUrl =
            getBaseUrl(settings);
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
      config: {
        rateLimit: {
          max: 5,
          timeWindow: "1 minute",
          keyGenerator: twoFaDisableKeyGenerator,
        },
      },
      schema: {
        tags: ["Auth"],
        summary: "Disable 2FA",
        body: {
          type: "object",
          properties: {
            password: { type: "string" },
            code: { type: "string" },
          },
        },
        response: {
          200: { description: "OK" },
          400: { description: "Validation failed" },
          401: { description: "Invalid password or code" },
          403: { description: "2FA enforced" },
          404: { description: "User not found" },
          429: { description: "Rate limited or locked" },
        },
      },
    },
    async (request, reply) => {
      if (
        !requireSession(request, reply as Parameters<typeof requireSession>[1])
      )
        return;
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
      const settings = readSettings();
      if (settings.two_factor_enabled && settings.two_factor_enforced) {
        return reply.status(403).send({
          error:
            "2FA is enforced by the administrator. You cannot disable it.",
        });
      }
      const parsed = twoFactorDisableBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: parsed.error.issues[0]?.message ?? "Validation failed", details: parsed.error.flatten() });
      }
      const password = parsed.data.password?.trim();
      const code = parsed.data.code?.trim();

      const row = drizzleDb
        .select({
          passwordHash: users.passwordHash,
          email: users.email,
          twoFactorMethod: users.twoFactorMethod,
          totpSecretEnc: users.totpSecretEnc,
        })
        .from(users)
        .where(eq(users.id, request.userId))
        .limit(1)
        .get();

      if (!row) {
        return reply.status(404).send({ error: "User not found" });
      }

      const isFederated =
        !row.passwordHash || row.passwordHash.trim() === "";

      let verified = false;

      if (isFederated) {
        if (!code) {
          return reply.status(400).send({
            error:
              "Federated accounts have no password. Provide your 2FA code to disable.",
          });
        }
        const lockedRow = drizzleDb
          .select({ totpLockedUntil: users.totpLockedUntil })
          .from(users)
          .where(eq(users.id, request.userId))
          .limit(1)
          .get();
        const federatedLockedMs = parseDatetimeToMs(lockedRow?.totpLockedUntil);
        if (
          lockedRow?.totpLockedUntil &&
          !Number.isNaN(federatedLockedMs) &&
          federatedLockedMs > Date.now()
        ) {
          const retrySec = Math.ceil((federatedLockedMs - Date.now()) / 1000);
          return reply
            .status(429)
            .header("Retry-After", String(Math.max(1, retrySec)))
            .send({
              error: "Too many failed attempts. Please try again later.",
            });
        }
        if (row.totpSecretEnc) {
          try {
            const secret = decryptTotpSecret(row.totpSecretEnc);
            verified = await verifyTotp(secret, code);
          } catch {
            /* invalid */
          }
        } else if (row.twoFactorMethod?.includes("email")) {
          const codeHash = sha256Hex(code);
          const otpRow = drizzleDb
            .select({ id: userOtpCodes.id })
            .from(userOtpCodes)
            .where(
              and(
                eq(userOtpCodes.userId, request.userId),
                eq(userOtpCodes.codeHash, codeHash),
                gt(userOtpCodes.expiresAt, sql`datetime('now')`),
              ),
            )
            .limit(1)
            .get();
          if (otpRow) {
            verified = true;
            drizzleDb
              .delete(userOtpCodes)
              .where(eq(userOtpCodes.id, otpRow.id))
              .run();
          }
        }
        if (!verified) {
          const result = recordTOTPFailureAndCheckLockout(
            request.userId,
            getClientIp(request),
            getUserAgent(request),
          );
          if (result.locked) {
            return reply
              .status(429)
              .header("Retry-After", String(result.retryAfterSec ?? 900))
              .send({
                error:
                  "Too many failed attempts. Please try again in 15 minutes.",
              });
          }
          return reply.status(401).send({ error: "Invalid or expired code" });
        }
      } else {
        if (!password) {
          return reply.status(400).send({ error: "Password is required" });
        }
        verified = await argon2.verify(row.passwordHash!, password);
        if (!verified) {
          return reply.status(401).send({ error: "Invalid password" });
        }
      }
      drizzleDb
        .update(users)
        .set({
          totpSecretEnc: null,
          twoFactorMethod: null,
          totpLockedUntil: null,
        })
        .where(eq(users.id, request.userId))
        .run();
      drizzleDb
        .delete(userTotpAttempts)
        .where(eq(userTotpAttempts.userId, request.userId))
        .run();
      if (
        isEmailProviderConfigured(settings)
      ) {
        if (row.email) {
          const baseUrl =
            getBaseUrl(settings);
          const { subject, text, html } = build2FARemovedEmail(baseUrl);
          void sendMail({ to: row.email, subject, text, html });
        }
      }
      return reply.send({ ok: true });
    },
  );
}
