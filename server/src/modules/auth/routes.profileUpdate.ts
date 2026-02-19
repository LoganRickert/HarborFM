import type { FastifyInstance } from "fastify";
import argon2 from "argon2";
import { randomBytes } from "crypto";
import { and, eq, gt, ne, sql } from "drizzle-orm";
import { requireAuth, requireNotReadOnly } from "../../plugins/auth.js";
import { userRateLimitPreHandler } from "../../services/rateLimit.js";
import { drizzleDb } from "../../db/index.js";
import {
  auth2faChallenges,
  userOtpCodes,
  users,
} from "../../db/schema.js";
import { readSettings, isEmailProviderConfigured } from "../settings/index.js";
import { parseUtcDatetime } from "../../utils/datetime.js";
import { sha256Hex } from "../../utils/hash.js";
import { sqlNow } from "../../db/utils.js";
import { sendMail, buildWelcomeVerificationEmail } from "../../services/email.js";
import {
  COOKIE_OPTS,
  CSRF_COOKIE_OPTS,
  newCsrfToken,
  VERIFICATION_TOKEN_BYTES,
  VERIFICATION_EXPIRY_HOURS,
} from "./shared.js";
import {
  JWT_COOKIE_NAME,
  CSRF_COOKIE_NAME,
  PROFILE_UPDATE_RATE_LIMIT_MINUTES,
  PROFILE_UPDATE_RATE_LIMIT_MS,
  PROFILE_UPDATE_REQUEST_RATE_LIMIT_MS,
  PROFILE_UPDATE_REQUEST_RATE_LIMIT_MAX,
  JWT_SESSION_EXPIRY,
} from "../../config.js";
import {
  requireSession,
  get2FAChallengeToken,
  getBaseUrl,
  buildAuthJwtPayload,
  create2FAChallenge,
  TWOFA_CHALLENGE_COOKIE_OPTS,
} from "./shared.js";
import { TWOFA_CHALLENGE_COOKIE_NAME } from "../../config.js";
import { verifyTotp, decryptTotpSecret } from "../../services/twoFactor.js";
import { profileUpdateBodySchema, USERNAME_REGEX, USERNAME_MIN_LENGTH_ERROR, USERNAME_PATTERN_ERROR } from "@harborfm/shared";

export async function registerProfileUpdateRoutes(app: FastifyInstance) {
  app.post(
    "/auth/me/profile/update",
    {
      preHandler: [
        requireAuth,
        requireNotReadOnly,
        userRateLimitPreHandler({
          bucket: "profile-update",
          windowMs: PROFILE_UPDATE_REQUEST_RATE_LIMIT_MS,
          max: PROFILE_UPDATE_REQUEST_RATE_LIMIT_MAX,
        }),
      ],
      schema: {
        tags: ["Auth"],
        summary: "Update email and/or username",
        description:
          `Change email or username. Requires password (and 2FA if enabled). Rate limited to ${PROFILE_UPDATE_REQUEST_RATE_LIMIT_MAX} requests per minute; email/username changes are limited to once per ${PROFILE_UPDATE_RATE_LIMIT_MINUTES} minutes.`,
        body: {
          type: "object",
          properties: {
            password: { type: "string" },
            code: { type: "string" },
            email: { type: "string" },
            username: { type: "string", minLength: 6 },
          },
        },
        response: {
          200: { description: "Updated or requires 2FA" },
          400: { description: "Validation failed" },
          401: { description: "Invalid password or code" },
          403: { description: "Read-only or no password" },
          404: { description: "User not found" },
          429: { description: "Rate limited" },
        },
      },
    },
    async (request, reply) => {
      if (
        !requireSession(request, reply as Parameters<typeof requireSession>[1])
      ) {
        return;
      }

      // Defense-in-depth: reject disabled and read-only accounts
      const userStatus = drizzleDb
        .select({
          disabled: sql<number>`COALESCE(${users.disabled}, 0)`.as("disabled"),
          read_only: sql<number>`COALESCE(${users.readOnly}, 0)`.as("read_only"),
        })
        .from(users)
        .where(eq(users.id, request.userId))
        .limit(1)
        .get();
      if (userStatus?.disabled === 1) {
        return reply.status(403).send({ error: "Account is disabled." });
      }
      if (userStatus?.read_only === 1) {
        return reply.status(403).send({
          error: "Read-only access; this action is not allowed.",
        });
      }

      const parsed = profileUpdateBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: parsed.error.issues[0]?.message ?? "Validation failed", details: parsed.error.flatten() });
      }
      const body = parsed.data;

      const emailRaw = body.email;
      const email =
        typeof emailRaw === "string" ? emailRaw.trim() : undefined;
      const username =
        typeof body.username === "string" ? body.username.trim() : undefined;
      const emailExplicitlyProvided = body.email !== undefined;
      const usernameExplicitlyProvided = body.username !== undefined;
      const settings = readSettings();
      const emailProviderConfigured = isEmailProviderConfigured(settings);

      let userId: string;
      let row: {
        id: string;
        email: string | null;
        username: string | null;
        passwordHash: string | null;
        profileEmailUsernameUpdatedAt: string | null;
        twoFactorMethod: string | null;
        totpSecretEnc: string | null;
        totpLockedUntil: string | null;
      };

      // Step 1: Verify via challengeToken + code (after 2FA). Challenge from HttpOnly cookie only.
      const challengeToken = get2FAChallengeToken(request);
      if (challengeToken && body.code?.trim()) {
        const tokenHash = sha256Hex(challengeToken);
        const challenge = drizzleDb
          .select({
            userId: auth2faChallenges.userId,
            method: auth2faChallenges.method,
            id: users.id,
            email: users.email,
            username: users.username,
            passwordHash: users.passwordHash,
            profileEmailUsernameUpdatedAt: users.profileEmailUsernameUpdatedAt,
            twoFactorMethod: users.twoFactorMethod,
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

        if (!challenge || challenge.userId !== request.userId) {
          return reply.status(400).send({
            error: "Invalid or expired challenge. Please try again.",
          });
        }

        if (
          challenge.totpLockedUntil &&
          new Date(challenge.totpLockedUntil) > new Date()
        ) {
          return reply.status(429).send({
            error: "Too many failed attempts. Please try again later.",
          });
        }

        let valid = false;
        if (challenge.method === "totp" && challenge.totpSecretEnc) {
          try {
            const secret = decryptTotpSecret(challenge.totpSecretEnc);
            valid = await verifyTotp(secret, body.code.trim());
          } catch {
            /* invalid */
          }
        } else if (challenge.method === "email") {
          const codeHash = sha256Hex(body.code.trim());
          const otpRow = drizzleDb
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
          if (otpRow) {
            valid = true;
            drizzleDb
              .delete(userOtpCodes)
              .where(eq(userOtpCodes.id, otpRow.id))
              .run();
          }
        }

        if (!valid) {
          return reply.status(401).send({ error: "Invalid code" });
        }

        drizzleDb
          .delete(auth2faChallenges)
          .where(eq(auth2faChallenges.tokenHash, tokenHash))
          .run();

        userId = challenge.userId;
        row = {
          id: challenge.id,
          email: challenge.email,
          username: challenge.username,
          passwordHash: challenge.passwordHash,
          profileEmailUsernameUpdatedAt: challenge.profileEmailUsernameUpdatedAt,
          twoFactorMethod: challenge.twoFactorMethod,
          totpSecretEnc: challenge.totpSecretEnc,
          totpLockedUntil: challenge.totpLockedUntil,
        };
      }
      // Step 2: Verify via password
      else if (body.password?.trim()) {
        const userRow = drizzleDb
          .select({
            id: users.id,
            email: users.email,
            username: users.username,
            passwordHash: users.passwordHash,
            profileEmailUsernameUpdatedAt: users.profileEmailUsernameUpdatedAt,
            twoFactorMethod: users.twoFactorMethod,
            totpSecretEnc: users.totpSecretEnc,
            totpLockedUntil: users.totpLockedUntil,
          })
          .from(users)
          .where(eq(users.id, request.userId))
          .limit(1)
          .get() as typeof row | undefined;

        if (!userRow) {
          return reply.status(404).send({ error: "User not found" });
        }

        if (!userRow.passwordHash) {
          return reply.status(403).send({
            error: "Set a password first (use Forgot password) to change email or username.",
          });
        }

        const valid = await argon2.verify(
          userRow.passwordHash,
          body.password.trim(),
        );
        if (!valid) {
          return reply.status(401).send({ error: "Invalid password" });
        }

        // If user has 2FA, create challenge and return - do not update yet
        if (userRow.twoFactorMethod?.trim()) {
          const method =
            userRow.twoFactorMethod.includes("email") &&
            emailProviderConfigured &&
            userRow.email
              ? "email"
              : "totp";
          const { challengeToken } = create2FAChallenge(userRow.id, method);
          return reply
            .setCookie(TWOFA_CHALLENGE_COOKIE_NAME, challengeToken, TWOFA_CHALLENGE_COOKIE_OPTS)
            .header("Cache-Control", "no-store")
            .send({
              requires2FA: true,
              method,
            });
        }

        userId = userRow.id;
        row = userRow;
      }
      // Step 3: Federated path (no password - session only)
      else {
        const userRow = drizzleDb
          .select({
            id: users.id,
            email: users.email,
            username: users.username,
            passwordHash: users.passwordHash,
            profileEmailUsernameUpdatedAt: users.profileEmailUsernameUpdatedAt,
            twoFactorMethod: users.twoFactorMethod,
            totpSecretEnc: users.totpSecretEnc,
            totpLockedUntil: users.totpLockedUntil,
          })
          .from(users)
          .where(eq(users.id, request.userId))
          .limit(1)
          .get() as typeof row | undefined;

        if (!userRow) {
          return reply.status(404).send({ error: "User not found" });
        }

        if (userRow.passwordHash != null && userRow.passwordHash.trim() !== "") {
          return reply.status(400).send({
            error: "Password or challenge token and code required.",
          });
        }

        // Federated user: if 2FA enabled, require 2FA before update
        if (userRow.twoFactorMethod?.trim()) {
          const method =
            userRow.twoFactorMethod.includes("email") &&
            emailProviderConfigured &&
            userRow.email
              ? "email"
              : "totp";
          const { challengeToken } = create2FAChallenge(userRow.id, method);
          return reply
            .setCookie(TWOFA_CHALLENGE_COOKIE_NAME, challengeToken, TWOFA_CHALLENGE_COOKIE_OPTS)
            .header("Cache-Control", "no-store")
            .send({
              requires2FA: true,
              method,
            });
        }

        userId = userRow.id;
        row = userRow;
      }

      // Rate limit
      if (row.profileEmailUsernameUpdatedAt) {
        const updatedAt = parseUtcDatetime(row.profileEmailUsernameUpdatedAt);
        if (
          !Number.isNaN(updatedAt) &&
          Date.now() - updatedAt < PROFILE_UPDATE_RATE_LIMIT_MS
        ) {
          const retrySec = Math.ceil(
            (updatedAt + PROFILE_UPDATE_RATE_LIMIT_MS - Date.now()) / 1000,
          );
          const period =
            PROFILE_UPDATE_RATE_LIMIT_MINUTES === 1
              ? "1 minute"
              : `${PROFILE_UPDATE_RATE_LIMIT_MINUTES} minutes`;
          return reply
            .status(429)
            .header("Retry-After", String(Math.max(1, retrySec)))
            .send({
              error: `You can only change email or username once every ${period}.`,
            });
        }
      }

      if (!emailExplicitlyProvided && !usernameExplicitlyProvided) {
        return reply.status(400).send({
          error: "Provide at least one of email or username to update.",
        });
      }
      if (emailExplicitlyProvided && email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return reply.status(400).send({
          error: "Please enter a valid email address.",
        });
      }

      let newEmail: string | null = row.email;
      let usernameApplied = true; // true when no username change requested or we applied it
      let emailAvailable = true;

      if (emailExplicitlyProvided) {
        if (email) {
          const canonicalEmail = email.toLowerCase();
          if (canonicalEmail !== (row.email ?? "").toLowerCase()) {
            const emailExisting = drizzleDb
              .select({ id: users.id })
              .from(users)
              .where(
                and(
                  sql`LOWER(${users.email}) = ${canonicalEmail}`,
                  ne(users.id, userId),
                ),
              )
              .limit(1)
              .get();
            if (!emailExisting) {
              newEmail = canonicalEmail;
              emailAvailable = true;
            } else {
              emailAvailable = false;
            }
          }
        } else {
          if (row.twoFactorMethod?.includes("email")) {
            return reply.status(400).send({
              error:
                "Cannot remove email while email 2FA is enabled. Disable email 2FA first, then you can remove your email.",
            });
          }
          newEmail = null;
          emailAvailable = true;
        }
      }

      if (username) {
        if (username.length < 6) {
          return reply.status(400).send({ error: USERNAME_MIN_LENGTH_ERROR });
        }
        if (!USERNAME_REGEX.test(username)) {
          return reply.status(400).send({ error: USERNAME_PATTERN_ERROR });
        }
        const canonicalUsername = username.toLowerCase();
        if (canonicalUsername !== (row.username ?? "").toLowerCase()) {
          const usernameExisting = drizzleDb
            .select({ id: users.id })
            .from(users)
            .where(
              and(
                sql`LOWER(${users.username}) = ${canonicalUsername}`,
                ne(users.id, userId),
              ),
            )
            .limit(1)
            .get();
          if (!usernameExisting) {
            // Will apply below
            usernameApplied = true;
          } else {
            usernameApplied = false;
          }
        }
      }

      const finalEmail = email !== undefined ? newEmail : row.email;
      const finalUsername =
        username !== undefined
          ? usernameApplied
            ? username!.trim().toLowerCase()
            : row.username
          : row.username;

      const emailChangeRequested =
        emailExplicitlyProvided && (newEmail ?? "") !== (row.email ?? "");
      const emailChangeWithVerification =
        emailChangeRequested && emailProviderConfigured && Boolean(newEmail);

      // Always generate token in memory for timing uniformity (even when email taken)
      const tokenBytes = randomBytes(VERIFICATION_TOKEN_BYTES).toString(
        "base64url",
      );
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + VERIFICATION_EXPIRY_HOURS);
      const expiresAtIso = expiresAt.toISOString();

      let emailVerificationToken: string | null = null;

      if (emailChangeWithVerification) {
        if (emailAvailable) {
          emailVerificationToken = tokenBytes;
          const emailVerificationTokenHash = sha256Hex(tokenBytes);
          drizzleDb
            .update(users)
            .set({
              username: finalUsername,
              profileEmailUsernameUpdatedAt: sqlNow(),
              pendingEmail: finalEmail,
              emailVerificationTokenHash: emailVerificationTokenHash,
              emailVerificationExpiresAt: expiresAtIso,
            })
            .where(eq(users.id, userId))
            .run();
          const baseUrl =
            getBaseUrl(settings);
          const verifyUrl = `${baseUrl}/verify-email?token=${encodeURIComponent(emailVerificationToken)}`;
          const { subject, text, html } =
            buildWelcomeVerificationEmail(verifyUrl);
          void sendMail({ to: finalEmail!, subject, text, html });
        } else {
          // Email taken: do not persist/send, but apply username if requested and bump rate limit
          if (usernameApplied && username && finalUsername !== row.username) {
            drizzleDb
              .update(users)
              .set({
                username: finalUsername,
                profileEmailUsernameUpdatedAt: sqlNow(),
              })
              .where(eq(users.id, userId))
              .run();
          } else {
            drizzleDb
              .update(users)
              .set({ profileEmailUsernameUpdatedAt: sqlNow() })
              .where(eq(users.id, userId))
              .run();
          }
        }
      } else if (emailChangeRequested && !emailChangeWithVerification) {
        drizzleDb
          .update(users)
          .set({
            email: finalEmail,
            ...(finalEmail === null && { emailVerified: false }),
            username: finalUsername,
            profileEmailUsernameUpdatedAt: sqlNow(),
            pendingEmail: null,
            emailVerificationTokenHash: null,
            emailVerificationExpiresAt: null,
          })
          .where(eq(users.id, userId))
          .run();
      } else {
        if (
          (emailExplicitlyProvided && (finalEmail ?? "") !== (row.email ?? "")) ||
          (usernameExplicitlyProvided &&
            (finalUsername ?? "") !== (row.username ?? ""))
        ) {
          drizzleDb
            .update(users)
            .set({
              email: finalEmail,
              ...(finalEmail === null && { emailVerified: false }),
              username: finalUsername,
              profileEmailUsernameUpdatedAt: sqlNow(),
              pendingEmail: null,
              emailVerificationTokenHash: null,
              emailVerificationExpiresAt: null,
            })
            .where(eq(users.id, userId))
            .run();
        }
      }

      const responseEmail = emailChangeWithVerification ? row.email : finalEmail;
      const responseUsername = finalUsername;

      const token = app.jwt.sign(
        buildAuthJwtPayload({
          id: userId,
          email: responseEmail,
          username: responseUsername,
        }),
        { expiresIn: JWT_SESSION_EXPIRY },
      );

      const applied = {
        username: usernameApplied,
        email: emailChangeWithVerification ? ("pending" as const) : ("none" as const),
      };

      return reply
        .clearCookie(TWOFA_CHALLENGE_COOKIE_NAME, { path: "/" })
        .setCookie(JWT_COOKIE_NAME, token, COOKIE_OPTS)
        .setCookie(CSRF_COOKIE_NAME, newCsrfToken(), CSRF_COOKIE_OPTS)
        .send({
          user: {
            id: userId,
            email: responseEmail,
            username: responseUsername,
          },
          needsVerification: Boolean(emailChangeWithVerification),
          message: emailChangeWithVerification
            ? "If that email can be used, we'll send a verification link."
            : undefined,
          applied,
        });
    },
  );
}
