import type { FastifyInstance } from "fastify";
import { and, eq, sql } from "drizzle-orm";
import { requireAuth, requireNotReadOnly } from "../../plugins/auth.js";
import { drizzleDb } from "../../db/index.js";
import { platformInvites, users } from "../../db/schema.js";
import { authInviteBodySchema } from "@harborfm/shared";
import { readSettings } from "../settings/index.js";
import {
  sendMail,
  buildInviteToPlatformEmail,
} from "../../services/email.js";
import { getBaseUrl, redactEmail } from "./shared.js";
import { MAX_PLATFORM_INVITES_PER_DAY } from "../../config.js";

export async function registerInviteRoutes(app: FastifyInstance) {
  app.post(
    "/invite-to-platform",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Auth"],
        summary: "Invite someone to join the platform",
        description:
          "Send an email inviting the recipient to create an account. Rate limited per user per day.",
        body: {
          type: "object",
          properties: { email: { type: "string" } },
          required: ["email"],
        },
        response: {
          200: { description: "Invite sent" },
          400: { description: "Invalid email or cannot send invite" },
          429: { description: "Rate limited" },
          503: { description: "Email not configured" },
        },
      },
    },
    async (request, reply) => {
      const parsed = authInviteBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({
            error:
              parsed.error.issues[0]?.message ?? "Valid email is required",
            details: parsed.error.flatten(),
          });
      }
      const email = parsed.data.email.trim().toLowerCase();
      const userId = request.userId as string;
      const countLast24h = drizzleDb
        .select({ count: sql<number>`count(*)`.as("count") })
        .from(platformInvites)
        .where(
          and(
            eq(platformInvites.inviterUserId, userId),
            sql`${platformInvites.createdAt} > datetime('now', '-1 day')`,
          ),
        )
        .get();
      if ((countLast24h?.count ?? 0) >= MAX_PLATFORM_INVITES_PER_DAY) {
        return reply
          .status(429)
          .send({
            error:
              "You have reached the limit of platform invites per day. Try again tomorrow.",
          });
      }
      const sameEmailRecent = drizzleDb
        .select({ one: sql`1` })
        .from(platformInvites)
        .where(
          and(
            sql`LOWER(${platformInvites.email}) = ${email}`,
            sql`${platformInvites.createdAt} > datetime('now', '-1 day')`,
          ),
        )
        .limit(1)
        .get();
      const alreadyRegistered = drizzleDb
        .select({ one: sql`1` })
        .from(users)
        .where(sql`LOWER(${users.email}) = ${email}`)
        .limit(1)
        .get();
      if (sameEmailRecent || alreadyRegistered) {
        return reply
          .status(400)
          .send({
            error: "Cannot send invite to this email address. It may already be registered or a recent invite was sent.",
          });
      }
      const settings = readSettings();
      if (settings.email_provider === "none") {
        return reply
          .status(503)
          .send({
            error:
              "Email is not configured. Ask an administrator to set up email.",
          });
      }
      if (!settings.email_enable_invite) {
        return reply
          .status(503)
          .send({ error: "Invite emails are disabled in settings." });
      }
      const baseUrl = getBaseUrl(settings);
      const registerUrl = `${baseUrl}/register`;
      const { subject, text, html } = buildInviteToPlatformEmail(registerUrl);
      const sendResult = await sendMail({ to: email, subject, text, html });
      if (!sendResult.sent) {
        request.log.warn(
          { emailRedacted: redactEmail(email), err: sendResult.error },
          "Invite-to-platform email failed",
        );
        return reply
          .status(503)
          .send({ error: sendResult.error ?? "Failed to send email" });
      }
      drizzleDb.insert(platformInvites).values({
        inviterUserId: userId,
        email,
      }).run();
      return reply.send({ ok: true });
    },
  );
}
