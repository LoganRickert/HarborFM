import type { FastifyInstance } from "fastify";
import { requireAuth, requireNotReadOnly } from "../../plugins/auth.js";
import { db } from "../../db/index.js";
import { authInviteBodySchema } from "@harborfm/shared";
import { readSettings } from "../settings/index.js";
import {
  sendMail,
  buildInviteToPlatformEmail,
} from "../../services/email.js";
import { normalizeHostname } from "../../utils/url.js";
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
          400: { description: "Invalid email or already sent" },
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
      const countLast24h = db
        .prepare(
          `SELECT COUNT(*) as count FROM platform_invites WHERE inviter_user_id = ? AND created_at > datetime('now', '-1 day')`,
        )
        .get(userId) as { count: number };
      if (countLast24h.count >= MAX_PLATFORM_INVITES_PER_DAY) {
        return reply
          .status(429)
          .send({
            error:
              "You have reached the limit of platform invites per day. Try again tomorrow.",
          });
      }
      const sameEmailRecent = db
        .prepare(
          `SELECT 1 FROM platform_invites WHERE LOWER(email) = ? AND created_at > datetime('now', '-1 day') LIMIT 1`,
        )
        .get(email);
      if (sameEmailRecent) {
        return reply
          .status(400)
          .send({
            error:
              "An invite was already sent to this email recently. Please wait 24 hours.",
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
      const baseUrl =
        normalizeHostname(settings.hostname || "") || "http://localhost";
      const signupUrl = `${baseUrl}/signup`;
      const { subject, text, html } = buildInviteToPlatformEmail(signupUrl);
      const sendResult = await sendMail({ to: email, subject, text, html });
      if (!sendResult.sent) {
        request.log.warn(
          { emailRedacted: email.slice(0, 3) + "***", err: sendResult.error },
          "Invite-to-platform email failed",
        );
        return reply
          .status(503)
          .send({ error: sendResult.error ?? "Failed to send email" });
      }
      db.prepare(
        "INSERT INTO platform_invites (inviter_user_id, email) VALUES (?, ?)",
      ).run(userId, email);
      return reply.send({ ok: true });
    },
  );
}
