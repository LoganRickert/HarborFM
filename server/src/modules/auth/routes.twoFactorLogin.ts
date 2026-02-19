import type { FastifyInstance } from "fastify";
import { randomInt } from "crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import { drizzleDb } from "../../db/index.js";
import {
  auth2faChallenges,
  userOtpCodes,
  userTotpAttempts,
  users,
} from "../../db/schema.js";
import {
  verify2FABodySchema,
  send2FAEmailCodeBodySchema,
  setup2FABodySchema,
  confirm2FASetupBodySchema,
  parseTwoFactorMethods,
  isMethodAllowed,
} from "@harborfm/shared";
import { readSettings, isEmailProviderConfigured } from "../settings/index.js";
import {
  getClientIp,
  getIpBan,
  getUserAgent,
  recordTOTPFailureAndCheckLockout,
} from "../../services/loginAttempts.js";
import { sendMail, build2FAAddedEmail } from "../../services/email.js";
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
  CSRF_COOKIE_NAME,
  JWT_COOKIE_NAME,
  AUTH_2FA_CHALLENGE_EXPIRY_MS,
  JWT_SESSION_EXPIRY,
} from "../../config.js";
import {
  COOKIE_OPTS,
  CSRF_COOKIE_OPTS,
  buildAuthJwtPayload,
  create2FARateLimitKeyGen,
  generateSecureOtp,
  newCsrfToken,
  get2FAChallengeToken,
} from "./shared.js";
import { TWOFA_CHALLENGE_COOKIE_NAME } from "../../config.js";
import { parseDatetimeToMs } from "../../utils/datetime.js";

/** Small random delay to reduce timing oracle between invalid-challenge vs invalid-code responses. */
function timingSafeDelayMs(min = 80, max = 180): Promise<void> {
  const ms = randomInt(min, max + 1);
  return new Promise((r) => setTimeout(r, ms));
}

export async function registerTwoFactorLoginRoutes(app: FastifyInstance) {
  const twoFaVerifyKeyGenerator = (request: {
    body?: unknown;
    ip?: string;
    cookies?: Record<string, string | undefined>;
  }) => create2FARateLimitKeyGen("2fa-verify")(request);

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
          required: ["code"],
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
      reply.header("Cache-Control", "no-store");
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

      const challengeToken = get2FAChallengeToken(request);
      if (!challengeToken) {
        return reply
          .status(400)
          .header("Cache-Control", "no-store")
          .send({ error: "Challenge required. Please sign in again." });
      }
      const parsed = verify2FABodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).header("Cache-Control", "no-store").send({
          error: "Validation failed",
          details: parsed.error.flatten(),
        });
      }
      const { code } = parsed.data;
      const tokenHash = sha256Hex(challengeToken);

      const challenge = drizzleDb
        .select({
          userId: auth2faChallenges.userId,
          method: auth2faChallenges.method,
          email: users.email,
          username: users.username,
          totpSecretEnc: users.totpSecretEnc,
          totpLockedUntil: users.totpLockedUntil,
        })
        .from(auth2faChallenges)
        .innerJoin(users, eq(users.id, auth2faChallenges.userId))
        .where(
          and(
            eq(auth2faChallenges.tokenHash, tokenHash),
            gt(auth2faChallenges.expiresAt, sql`datetime('now')`),
          ),
        )
        .limit(1)
        .get();

      if (!challenge) {
        await timingSafeDelayMs();
        return reply
          .status(400)
          .send({ error: "Invalid or expired challenge. Please sign in again." });
      }

      const challengeLockedMs = parseDatetimeToMs(challenge.totpLockedUntil);
      if (
        challenge.totpLockedUntil &&
        !Number.isNaN(challengeLockedMs) &&
        challengeLockedMs > Date.now()
      ) {
        const retrySec = Math.ceil((challengeLockedMs - Date.now()) / 1000);
        return reply
          .status(429)
          .header("Retry-After", String(Math.max(1, retrySec)))
          .send({
            error: "Too many failed attempts. Please try again later.",
          });
      }

      let valid = false;

      if (challenge.method === "totp" && challenge.totpSecretEnc) {
        let secret: string;
        try {
          secret = decryptTotpSecret(challenge.totpSecretEnc);
        } catch {
          return reply.status(401).send({ error: "Invalid code" });
        }
        valid = await verifyTotp(secret, code);
      } else if (challenge.method === "email") {
        const codeHash = sha256Hex(code.trim());
        const row = drizzleDb
          .select({ id: userOtpCodes.id })
          .from(userOtpCodes)
          .where(
            and(
              eq(userOtpCodes.userId, challenge.userId),
              eq(userOtpCodes.codeHash, codeHash),
              gt(userOtpCodes.expiresAt, sql`datetime('now')`),
            ),
          )
          .limit(1)
          .get();
        if (row) {
          valid = true;
          drizzleDb
            .delete(userOtpCodes)
            .where(eq(userOtpCodes.id, row.id))
            .run();
        }
      }

      if (!valid) {
        await timingSafeDelayMs();
        const result = recordTOTPFailureAndCheckLockout(
          challenge.userId,
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
        return reply.status(401).send({ error: "Invalid code" });
      }

      drizzleDb
        .delete(auth2faChallenges)
        .where(eq(auth2faChallenges.tokenHash, tokenHash))
        .run();
      drizzleDb
        .delete(userTotpAttempts)
        .where(eq(userTotpAttempts.userId, challenge.userId))
        .run();

      const token = app.jwt.sign(
        buildAuthJwtPayload({
          id: challenge.userId,
          email: challenge.email,
          username: challenge.username,
        }),
        { expiresIn: JWT_SESSION_EXPIRY },
      );
      return reply
        .clearCookie(TWOFA_CHALLENGE_COOKIE_NAME, { path: "/" })
        .setCookie(JWT_COOKIE_NAME, token, COOKIE_OPTS)
        .setCookie(CSRF_COOKIE_NAME, newCsrfToken(), CSRF_COOKIE_OPTS)
        .send({ user: { id: challenge.userId, email: challenge.email } });
    },
  );

  const twoFaSendEmailCodeKeyGenerator = (request: {
    body?: unknown;
    ip?: string;
    cookies?: Record<string, string | undefined>;
  }) => create2FARateLimitKeyGen("2fa-send-email")(request);

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
      reply.header("Cache-Control", "no-store");
      const settings = readSettings();
      if (
        !isEmailProviderConfigured(settings)
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
      const challengeToken = get2FAChallengeToken(request);
      if (!challengeToken) {
        return reply.status(400).send({ error: "Challenge required. Please sign in again." });
      }
      const tokenHash = sha256Hex(challengeToken);

      const challenge = drizzleDb
        .select({
          userId: auth2faChallenges.userId,
          method: auth2faChallenges.method,
          email: users.email,
        })
        .from(auth2faChallenges)
        .innerJoin(users, eq(users.id, auth2faChallenges.userId))
        .where(
          and(
            eq(auth2faChallenges.tokenHash, tokenHash),
            gt(auth2faChallenges.expiresAt, sql`datetime('now')`),
          ),
        )
        .limit(1)
        .get();

      if (!challenge || challenge.method !== "email") {
        return reply
          .status(400)
          .send({ error: "Invalid or expired challenge. Please sign in again." });
      }

      if (!challenge.email?.trim()) {
        return reply
          .status(400)
          .send({
            error:
              "No email on file for this account. Use your authenticator app instead.",
          });
      }

      drizzleDb
        .delete(userOtpCodes)
        .where(eq(userOtpCodes.userId, challenge.userId))
        .run();
      const otpCode = generateSecureOtp();
      const codeHash = sha256Hex(otpCode);
      const expiresAt = new Date(Date.now() + AUTH_2FA_CHALLENGE_EXPIRY_MS).toISOString();
      drizzleDb.insert(userOtpCodes).values({
        userId: challenge.userId,
        codeHash,
        expiresAt,
      }).run();

      const { build2FAEmailCodeEmail } = await import("../../services/email.js");
      const baseUrl =
        getBaseUrl(settings);
      const { subject, text, html } = build2FAEmailCodeEmail(baseUrl, otpCode);
      const sendResult = await sendMail({
        to: challenge.email!,
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
    cookies?: Record<string, string | undefined>;
  }) => {
    const body = request.body as { method?: string } | undefined;
    const token = get2FAChallengeToken(request);
    if (body?.method === "email" && token) {
      return create2FARateLimitKeyGen("2fa-send-email")(request);
    }
    return create2FARateLimitKeyGen("2fa-setup")(request);
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
          required: ["method"],
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
      reply.header("Cache-Control", "no-store");
      const parsed = setup2FABodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Validation failed" });
      }
      const challengeToken = get2FAChallengeToken(request);
      if (!challengeToken) {
        return reply.status(400).send({ error: "Challenge required. Please sign in again." });
      }
      const { method } = parsed.data;
      const tokenHash = sha256Hex(challengeToken);

      const challenge = drizzleDb
        .select({
          id: auth2faChallenges.id,
          userId: auth2faChallenges.userId,
          email: users.email,
          read_only: sql<number>`COALESCE(${users.readOnly}, 0)`.as("read_only"),
        })
        .from(auth2faChallenges)
        .innerJoin(users, eq(users.id, auth2faChallenges.userId))
        .where(
          and(
            eq(auth2faChallenges.tokenHash, tokenHash),
            gt(auth2faChallenges.expiresAt, sql`datetime('now')`),
          ),
        )
        .limit(1)
        .get();

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
          label: challenge.email ?? "",
          issuer: "HarborFM",
        });
        const qrDataUrl = await getTotpQrDataUrl(uri);
        const secretHash = sha256Hex(secret);
        drizzleDb
          .update(auth2faChallenges)
          .set({ totpSecretHash: secretHash })
          .where(eq(auth2faChallenges.tokenHash, tokenHash))
          .run();
        return reply.send({
          qrDataUrl,
          secret,
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
        if (!challenge.email?.trim()) {
          return reply
            .status(400)
            .send({
              error:
                "Email 2FA is not available. Add an email to your account first.",
            });
        }
        drizzleDb
          .delete(userOtpCodes)
          .where(eq(userOtpCodes.userId, challenge.userId))
          .run();
        const otpCode = generateSecureOtp();
        const codeHash = sha256Hex(otpCode);
        const expiresAt = new Date(Date.now() + AUTH_2FA_CHALLENGE_EXPIRY_MS).toISOString();
        drizzleDb.insert(userOtpCodes).values({
          userId: challenge.userId,
          codeHash,
          expiresAt,
        }).run();
        const { build2FAEmailCodeEmail } = await import(
          "../../services/email.js"
        );
        const baseUrl =
          getBaseUrl(settings);
        const { subject, text, html } = build2FAEmailCodeEmail(
          baseUrl,
          otpCode,
        );
        await sendMail({ to: challenge.email, subject, text, html });
        return reply.send({ ok: true });
      }

      return reply.status(400).send({ error: "Invalid method" });
    },
  );

  const twoFaConfirmSetupKeyGenerator = (request: {
    body?: unknown;
    ip?: string;
    cookies?: Record<string, string | undefined>;
  }) => create2FARateLimitKeyGen("2fa-confirm-setup")(request);

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
            secret: { type: "string" },
          },
          required: ["code"],
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
      reply.header("Cache-Control", "no-store");
      const challengeToken = get2FAChallengeToken(request);
      if (!challengeToken) {
        return reply.status(400).send({ error: "Challenge required. Please sign in again." });
      }
      const parsed = confirm2FASetupBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Validation failed" });
      }
      const { code } = parsed.data;
      const tokenHash = sha256Hex(challengeToken);

      const challenge = drizzleDb
        .select({
          id: auth2faChallenges.id,
          userId: auth2faChallenges.userId,
          totpSecretHash: auth2faChallenges.totpSecretHash,
          email: users.email,
          read_only: sql<number>`COALESCE(${users.readOnly}, 0)`.as("read_only"),
          totpLockedUntil: users.totpLockedUntil,
        })
        .from(auth2faChallenges)
        .innerJoin(users, eq(users.id, auth2faChallenges.userId))
        .where(
          and(
            eq(auth2faChallenges.tokenHash, tokenHash),
            gt(auth2faChallenges.expiresAt, sql`datetime('now')`),
          ),
        )
        .limit(1)
        .get();

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
      const confirmLockedMs = parseDatetimeToMs(challenge.totpLockedUntil);
      if (
        challenge.totpLockedUntil &&
        !Number.isNaN(confirmLockedMs) &&
        confirmLockedMs > Date.now()
      ) {
        const retrySec = Math.ceil((confirmLockedMs - Date.now()) / 1000);
        return reply
          .status(429)
          .header("Retry-After", String(Math.max(1, retrySec)))
          .send({ error: "Too many failed attempts. Please try again later." });
      }

      const body = request.body as { secret?: string };
      const hasSecret = typeof body?.secret === "string" && body.secret.trim();

      if (hasSecret) {
        const providedSecret = body.secret!.trim();
        if (challenge.totpSecretHash) {
          const providedHash = sha256Hex(providedSecret);
          if (providedHash !== challenge.totpSecretHash) {
            await timingSafeDelayMs();
            return reply.status(401).send({ error: "Invalid code" });
          }
        }
        const valid = await verifyTotp(providedSecret, code);
        if (!valid) {
          await timingSafeDelayMs();
          return reply.status(401).send({ error: "Invalid code" });
        }
        const totpChallenge = drizzleDb
          .select({
            id: auth2faChallenges.id,
            userId: auth2faChallenges.userId,
            email: users.email,
            username: users.username,
          })
          .from(auth2faChallenges)
          .innerJoin(users, eq(users.id, auth2faChallenges.userId))
          .where(
            and(
              eq(auth2faChallenges.tokenHash, tokenHash),
              gt(auth2faChallenges.expiresAt, sql`datetime('now')`),
            ),
          )
          .limit(1)
          .get();
        if (!totpChallenge) {
          return reply
            .status(400)
            .send({
              error: "Invalid or expired challenge. Please sign in again.",
            });
        }
        const secretEnc = encryptTotpSecret(providedSecret);
        drizzleDb
          .update(users)
          .set({ totpSecretEnc: secretEnc, twoFactorMethod: "totp" })
          .where(eq(users.id, totpChallenge.userId))
          .run();
        drizzleDb
          .delete(auth2faChallenges)
          .where(eq(auth2faChallenges.id, totpChallenge.id))
          .run();
        const totpSettings = readSettings();
        if (
          totpChallenge.email &&
          isEmailProviderConfigured(totpSettings)
        ) {
          const baseUrl =
            getBaseUrl(totpSettings);
          const { subject, text, html } = build2FAAddedEmail(baseUrl, "totp");
          void sendMail({
            to: totpChallenge.email!,
            subject,
            text,
            html,
          });
        }
        const token = app.jwt.sign(
          buildAuthJwtPayload({
            id: totpChallenge.userId,
            email: totpChallenge.email,
            username: totpChallenge.username,
          }),
          { expiresIn: JWT_SESSION_EXPIRY },
        );
        return reply
          .clearCookie(TWOFA_CHALLENGE_COOKIE_NAME, { path: "/" })
          .setCookie(JWT_COOKIE_NAME, token, COOKIE_OPTS)
          .setCookie(CSRF_COOKIE_NAME, newCsrfToken(), CSRF_COOKIE_OPTS)
          .send({
            user: {
              id: totpChallenge.userId,
              email: totpChallenge.email,
            },
          });
      }

      const emailChallenge = drizzleDb
        .select({
          id: auth2faChallenges.id,
          userId: auth2faChallenges.userId,
          email: users.email,
          username: users.username,
        })
        .from(auth2faChallenges)
        .innerJoin(users, eq(users.id, auth2faChallenges.userId))
        .where(
          and(
            eq(auth2faChallenges.tokenHash, tokenHash),
            gt(auth2faChallenges.expiresAt, sql`datetime('now')`),
          ),
        )
        .limit(1)
        .get();
      if (!emailChallenge) {
        return reply
          .status(400)
          .send({ error: "Invalid or expired challenge." });
      }
      const otpRow = drizzleDb
        .select({ id: userOtpCodes.id })
        .from(userOtpCodes)
        .where(
          and(
            eq(userOtpCodes.userId, emailChallenge.userId),
            eq(userOtpCodes.codeHash, sha256Hex(code.trim())),
            gt(userOtpCodes.expiresAt, sql`datetime('now')`),
          ),
        )
        .limit(1)
        .get();
        if (!otpRow) {
        await timingSafeDelayMs();
        const result = recordTOTPFailureAndCheckLockout(
          emailChallenge.userId,
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
        return reply.status(401).send({ error: "Invalid code" });
      }
      drizzleDb
        .delete(userOtpCodes)
        .where(eq(userOtpCodes.id, otpRow.id))
        .run();
      drizzleDb
        .delete(userTotpAttempts)
        .where(eq(userTotpAttempts.userId, emailChallenge.userId))
        .run();
      drizzleDb
        .update(users)
        .set({ twoFactorMethod: "email" })
        .where(eq(users.id, emailChallenge.userId))
        .run();
      drizzleDb
        .delete(auth2faChallenges)
        .where(eq(auth2faChallenges.id, emailChallenge.id))
        .run();
      const emailSettings = readSettings();
      if (
        emailChallenge.email &&
        isEmailProviderConfigured(emailSettings)
      ) {
        const baseUrl =
          getBaseUrl(emailSettings);
        const { subject, text, html } = build2FAAddedEmail(baseUrl, "email");
        void sendMail({
          to: emailChallenge.email,
          subject,
          text,
          html,
        });
      }
      const token = app.jwt.sign(
        buildAuthJwtPayload({
          id: emailChallenge.userId,
          email: emailChallenge.email,
          username: emailChallenge.username,
        }),
        { expiresIn: JWT_SESSION_EXPIRY },
      );
      return reply
        .clearCookie(TWOFA_CHALLENGE_COOKIE_NAME, { path: "/" })
        .setCookie(JWT_COOKIE_NAME, token, COOKIE_OPTS)
        .setCookie(CSRF_COOKIE_NAME, newCsrfToken(), CSRF_COOKIE_OPTS)
        .send({
          user: {
            id: emailChallenge.userId,
            email: emailChallenge.email,
          },
        });
    },
  );
}
