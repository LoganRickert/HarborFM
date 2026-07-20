import type { FastifyInstance } from "fastify";
import argon2 from "argon2";
import { nanoid } from "nanoid";
import { randomBytes } from "crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import { drizzleDb } from "../../db/index.js";
import { users } from "../../db/schema.js";
import { isUniqueViolation, sqlNow } from "../../db/utils.js";
import { registerBodySchema, authTokenQuerySchema } from "@harborfm/shared";
import { readSettings, isEmailProviderConfigured } from "../settings/index.js";
import { getClientIp, getUserAgent } from "../../services/loginAttempts.js";
import { getLocationForIp } from "../../services/geolocation.js";
import { verifyCaptcha } from "../../services/captcha.js";
import {
  sendMail,
  buildWelcomeVerificationEmail,
  buildWelcomeVerifiedEmail,
} from "../../services/email.js";
import { getBaseUrl } from "./shared.js";
import {
  CSRF_COOKIE_NAME,
  JWT_COOKIE_NAME,
  JWT_SESSION_EXPIRY,
  REGISTRATION_RATE_LIMIT_MAX,
} from "../../config.js";
import {
  COOKIE_OPTS,
  CSRF_COOKIE_OPTS,
  newCsrfToken,
  redactEmail,
  VERIFICATION_EXPIRY_HOURS,
  VERIFICATION_TOKEN_BYTES,
} from "./shared.js";
import { sha256Hex } from "../../utils/hash.js";

export async function registerRegisterRoutes(app: FastifyInstance) {
  app.post(
    "/auth/register",
    {
      config: {
        rateLimit: {
          max: REGISTRATION_RATE_LIMIT_MAX,
          timeWindow: "1 minute",
        },
      },
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
          429: { description: "Rate limited" },
        },
      },
    },
    async (request, reply) => {
      // Setup gate: if there are no users, the server must be bootstrapped first.
      // This prevents "first registrant becomes admin" on fresh installs.
      const userCount = drizzleDb
        .select({ count: sql<number>`count(*)`.as("count") })
        .from(users)
        .get();
      if ((userCount?.count ?? 0) === 0) {
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

      const canonicalEmail = email.trim().toLowerCase();
      const existing = drizzleDb
        .select({ id: users.id })
        .from(users)
        .where(sql`LOWER(${users.email}) = ${canonicalEmail}`)
        .limit(1)
        .get();
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
      const can_generate_video = settings.default_can_generate_video ? 1 : 0;
      const can_stripe = settings.default_can_stripe ? 1 : 0;
      const can_episode_alert = settings.default_can_episode_alert ? 1 : 0;
      const can_upload_episode_files = settings.default_can_upload_episode_files
        ? 1
        : 0;
      const can_import_theme = settings.default_can_import_theme ? 1 : 0;

      const requiresVerification =
        isEmailProviderConfigured(settings) &&
        settings.email_enable_registration_verification;
      let email_verified = 1;
      let email_verification_token: string | null = null;
      let email_verification_token_hash: string | null = null;
      let email_verification_expires_at: string | null = null;

      if (requiresVerification) {
        email_verified = 0;
        email_verification_token = randomBytes(
          VERIFICATION_TOKEN_BYTES,
        ).toString("base64url");
        email_verification_token_hash = sha256Hex(email_verification_token);
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + VERIFICATION_EXPIRY_HOURS);
        email_verification_expires_at = expiresAt.toISOString();
      }

      const defaultUsername = `user_${nanoid()}`;
      drizzleDb.insert(users).values({
        id,
        email: canonicalEmail,
        passwordHash: password_hash,
        username: defaultUsername,
        role: userRole,
        maxPodcasts: max_podcasts,
        maxStorageMb: max_storage_mb,
        maxEpisodes: max_episodes,
        maxCollaborators: max_collaborators,
        maxSubscriberTokens: max_subscriber_tokens,
        canTranscribe: can_transcribe,
        canGenerateVideo: can_generate_video,
        canStripe: can_stripe,
        canEpisodeAlert: can_episode_alert,
        canUploadEpisodeFiles: can_upload_episode_files,
        canImportTheme: can_import_theme,
        emailVerified: email_verified === 1,
        emailVerificationTokenHash: email_verification_token_hash,
        emailVerificationExpiresAt: email_verification_expires_at,
      }).run();

      if (requiresVerification) {
        const baseUrl = getBaseUrl(settings);
        const verifyUrl = `${baseUrl}/verify-email?token=${encodeURIComponent(email_verification_token!)}`;
        const { subject, text, html } =
          buildWelcomeVerificationEmail(verifyUrl);
        const sendResult = await sendMail({ to: canonicalEmail, subject, text, html });
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
      drizzleDb
        .update(users)
        .set({
          lastLoginAt: sqlNow(),
          lastLoginIp: ip,
          lastLoginUserAgent: userAgent,
          lastLoginLocation: location ?? null,
        })
        .where(eq(users.id, id))
        .run();
      const token = app.jwt.sign(
        { sub: id, email: canonicalEmail, username: defaultUsername },
        { expiresIn: JWT_SESSION_EXPIRY },
      );
      return reply
        .setCookie(JWT_COOKIE_NAME, token, COOKIE_OPTS)
        .setCookie(CSRF_COOKIE_NAME, newCsrfToken(), CSRF_COOKIE_OPTS)
        .send({ user: { id, email: canonicalEmail, username: defaultUsername } });
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
      const tokenHash = sha256Hex(token);
      const row = drizzleDb
        .select({
          id: users.id,
          email: users.email,
          username: users.username,
          pending_email: users.pendingEmail,
          disabled: sql<number>`COALESCE(${users.disabled}, 0)`.as("disabled"),
          read_only: sql<number>`COALESCE(${users.readOnly}, 0)`.as("read_only"),
        })
        .from(users)
        .where(
          and(
            eq(users.emailVerificationTokenHash, tokenHash),
            gt(users.emailVerificationExpiresAt, sqlNow()),
          ),
        )
        .limit(1)
        .get();
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

      const hasPendingEmail = Boolean(row.pending_email?.trim());

      if (hasPendingEmail) {
        try {
          drizzleDb
            .update(users)
            .set({
              email: row.pending_email!.trim(),
              emailVerified: true,
              pendingEmail: null,
              emailVerificationTokenHash: null,
              emailVerificationExpiresAt: null,
            })
            .where(eq(users.id, row.id))
            .run();
        } catch (err) {
          if (isUniqueViolation(err)) {
            drizzleDb
              .update(users)
              .set({
                pendingEmail: null,
                emailVerificationTokenHash: null,
                emailVerificationExpiresAt: null,
              })
              .where(eq(users.id, row.id))
              .run();
            return reply.status(400).send({
              error:
                "This email address is already in use. Please try a different one.",
            });
          }
          throw err;
        }
      } else {
        drizzleDb
          .update(users)
          .set({
            emailVerified: true,
            emailVerificationTokenHash: null,
            emailVerificationExpiresAt: null,
          })
          .where(eq(users.id, row.id))
          .run();
      }

      const verifiedEmail = hasPendingEmail ? row.pending_email!.trim() : row.email;

      const settings = readSettings();
      if (
        isEmailProviderConfigured(settings) &&
        settings.email_enable_welcome_after_verify
      ) {
        const baseUrl = getBaseUrl(settings);
        const { subject, text, html } = buildWelcomeVerifiedEmail(baseUrl);
        const sendResult = await sendMail({
          to: (verifiedEmail ?? row.email) || "",
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

      if (hasPendingEmail) {
        const newToken = app.jwt.sign(
          {
            sub: row.id,
            email: verifiedEmail ?? null,
            username: row.username ?? null,
          },
          { expiresIn: JWT_SESSION_EXPIRY },
        );
        return reply
          .setCookie(JWT_COOKIE_NAME, newToken, COOKIE_OPTS)
          .setCookie(CSRF_COOKIE_NAME, newCsrfToken(), CSRF_COOKIE_OPTS)
          .send({ ok: true });
      }

      return reply.send({ ok: true });
    },
  );
}
