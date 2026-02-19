import type { FastifyInstance } from "fastify";
import { and, eq, ne, sql } from "drizzle-orm";
import { requireAuth } from "../../plugins/auth.js";
import { randomBytes } from "crypto";
import { drizzleDb } from "../../db/index.js";
import { users } from "../../db/schema.js";
import { sha256Hex } from "../../utils/hash.js";
import { readSettings, isEmailProviderConfigured } from "../settings/index.js";
import { getBaseUrl } from "./shared.js";
import { sendMail, buildWelcomeVerificationEmail } from "../../services/email.js";
import { redactEmail } from "./shared.js";
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
  JWT_SESSION_EXPIRY,
} from "../../config.js";
import { completeAccountBodySchema } from "@harborfm/shared";

function needsCompleteAccount(
  email: string | null,
  emailVerified: number,
  username: string | null,
): boolean {
  const hasVerifiedEmail = email?.trim() && emailVerified === 1;
  const hasUsername = username?.trim();
  return !hasVerifiedEmail && !hasUsername;
}

export async function registerCompleteAccountRoutes(app: FastifyInstance) {
  app.post(
    "/auth/complete-account",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Auth"],
        summary: "Complete federated account",
        description:
          "Add email and/or username to a federated user account. Requires at least one. Username completes immediately; email requires verification.",
        body: {
          type: "object",
          properties: {
            email: { type: "string", format: "email" },
            username: { type: "string", minLength: 6 },
          },
          minProperties: 1,
        },
        response: {
          200: { description: "Complete" },
          201: { description: "Verification email sent" },
          400: { description: "Validation failed" },
          403: { description: "Account already complete or API key not allowed" },
          404: { description: "User not found" },
        },
      },
    },
    async (request, reply) => {
      if (request.authViaApiKey) {
        return reply.status(403).send({
          error: "Complete account via session only.",
        });
      }

      const parsed = completeAccountBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: parsed.error.issues[0]?.message ?? "Validation failed", details: parsed.error.flatten() });
      }
      const email = parsed.data.email?.trim();
      const username = parsed.data.username?.trim();

      const row = drizzleDb
        .select({
          id: users.id,
          email: users.email,
          email_verified: sql<number>`COALESCE(${users.emailVerified}, 1)`.as(
            "email_verified",
          ),
          username: users.username,
          password_hash: users.passwordHash,
        })
        .from(users)
        .where(eq(users.id, request.userId))
        .limit(1)
        .get();

      if (!row) {
        return reply.status(404).send({ error: "User not found" });
      }

      if (!needsCompleteAccount(row.email, row.email_verified, row.username)) {
        return reply.status(403).send({
          error: "Account is already complete.",
        });
      }

      const settings = readSettings();
      const emailProviderConfigured =
        isEmailProviderConfigured(settings);

      let newEmail: string | null = row.email;
      let newUsername: string | null = row.username;
      let emailVerified = row.email_verified;
      let emailVerificationToken: string | null = null;
      let emailVerificationTokenHash: string | null = null;
      let emailVerificationExpiresAt: string | null = null;

      if (username) {
        const canonicalUsername = username.toLowerCase();
        const existing = drizzleDb
          .select({ id: users.id })
          .from(users)
          .where(
            and(
              sql`LOWER(${users.username}) = ${canonicalUsername}`,
              ne(users.id, row.id),
            ),
          )
          .limit(1)
          .get();
        if (existing) {
          return reply.status(400).send({
            error: "Username is already taken.",
          });
        }
        newUsername = canonicalUsername;
      }

      if (email) {
        const canonicalEmail = email.trim().toLowerCase();
        const existing = drizzleDb
          .select({ id: users.id })
          .from(users)
          .where(
            and(
              sql`LOWER(${users.email}) = ${canonicalEmail}`,
              ne(users.id, row.id),
            ),
          )
          .limit(1)
          .get();
        if (existing) {
          return reply.status(400).send({
            error: "Email is already in use.",
          });
        }
        newEmail = canonicalEmail;
        if (emailProviderConfigured) {
          emailVerified = 0;
          emailVerificationToken = randomBytes(
            VERIFICATION_TOKEN_BYTES,
          ).toString("base64url");
          emailVerificationTokenHash = sha256Hex(emailVerificationToken);
          const expiresAt = new Date();
          expiresAt.setHours(expiresAt.getHours() + VERIFICATION_EXPIRY_HOURS);
          emailVerificationExpiresAt = expiresAt.toISOString();
        }
      }

      drizzleDb
        .update(users)
        .set({
          email: newEmail,
          username: newUsername,
          emailVerified: emailVerified === 1,
          emailVerificationTokenHash: emailVerificationTokenHash,
          emailVerificationExpiresAt: emailVerificationExpiresAt,
        })
        .where(eq(users.id, row.id))
        .run();

      const isComplete = Boolean(newUsername) || emailVerified === 1;

      if (isComplete) {
        const token = app.jwt.sign(
          {
            sub: row.id,
            email: newEmail ?? null,
            username: newUsername ?? null,
          },
          { expiresIn: JWT_SESSION_EXPIRY },
        );
        return reply
          .setCookie(JWT_COOKIE_NAME, token, COOKIE_OPTS)
          .setCookie(CSRF_COOKIE_NAME, newCsrfToken(), CSRF_COOKIE_OPTS)
          .send({
            ok: true,
            user: {
              id: row.id,
              email: newEmail,
              username: newUsername,
            },
          });
      }

      if (emailVerificationToken && newEmail && emailProviderConfigured) {
        const baseUrl =
          getBaseUrl(settings);
        const verifyUrl = `${baseUrl}/verify-email?token=${encodeURIComponent(emailVerificationToken)}`;
        const { subject, text, html } =
          buildWelcomeVerificationEmail(verifyUrl);
        const sendResult = await sendMail({
          to: newEmail,
          subject,
          text,
          html,
        });
        if (!sendResult.sent) {
          request.log.warn(
            { emailRedacted: redactEmail(newEmail), err: sendResult.error },
            "Complete-account verification email failed",
          );
        }
      }

      return reply.status(201).send({
        ok: true,
        needsVerification: true,
        message:
          "Check your email to verify your address, then sign in again.",
      });
    },
  );
}
