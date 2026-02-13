import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { contactBodySchema } from "@harborfm/shared";
import { db } from "../../db/index.js";
import { readSettings } from "../settings/index.js";
import { normalizeHostname } from "../../utils/url.js";
import { getClientIp } from "../../services/loginAttempts.js";
import { verifyCaptcha } from "../../services/captcha.js";
import { sendMail, buildContactNotificationEmail } from "../../services/email.js";

export async function contactRoutes(app: FastifyInstance) {
  app.post(
    "/contact",
    {
      schema: {
        tags: ["Contact"],
        summary: "Submit contact form",
        description:
          "Submit a contact message. Logged in DB; if email is configured, admins are notified. CAPTCHA required when enabled.",
        security: [],
        body: {
          type: "object",
          required: ["name", "email", "message"],
          properties: {
            name: { type: "string" },
            email: { type: "string", format: "email" },
            message: { type: "string" },
            captchaToken: { type: "string" },
            podcastSlug: { type: "string" },
            episodeSlug: { type: "string" },
          },
        },
        response: {
          200: {
            description: "Message sent",
            type: "object",
            properties: { ok: { type: "boolean" } },
          },
          400: { description: "Validation or CAPTCHA error" },
        },
      },
    },
    async (request, reply) => {
      const parsed = contactBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({
            error: parsed.error.issues[0]?.message ?? "Validation failed",
            details: parsed.error.flatten(),
          });
      }
      const { name, email, message, captchaToken, podcastSlug, episodeSlug } =
        parsed.data;

      let podcastId: string | null = null;
      let episodeId: string | null = null;
      let podcastTitle: string | null = null;
      let episodeTitle: string | null = null;

      if (podcastSlug) {
        const podcast = db
          .prepare("SELECT id, title FROM podcasts WHERE slug = ?")
          .get(podcastSlug) as { id: string; title: string } | undefined;
        if (podcast) {
          podcastId = podcast.id;
          podcastTitle = podcast.title;
          if (episodeSlug) {
            const episode = db
              .prepare(
                "SELECT id, title FROM episodes WHERE podcast_id = ? AND slug = ?",
              )
              .get(podcastId, episodeSlug) as
              | { id: string; title: string }
              | undefined;
            if (episode) {
              episodeId = episode.id;
              episodeTitle = episode.title;
            }
          }
        }
      }

      const ip = getClientIp(request);
      const settings = readSettings();

      if (settings.captcha_provider && settings.captcha_provider !== "none") {
        if (!captchaToken) {
          return reply
            .status(400)
            .send({
              error: "CAPTCHA is required. Please complete the challenge.",
            });
        }
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
            "Contact form: CAPTCHA verification failed",
          );
          return reply
            .status(400)
            .send({ error: verify.error ?? "CAPTCHA verification failed" });
        }
      }

      // If message is for a podcast/episode and the owner is read-only, do not log or send email.
      let ownerIsReadOnly = false;

      if (podcastId) {
        const owner = db
          .prepare(
            `SELECT COALESCE(u.read_only, 0) AS read_only FROM podcasts p
           INNER JOIN users u ON p.owner_user_id = u.id
           WHERE p.id = ?`,
          )
          .get(podcastId) as { read_only: number } | undefined;
        ownerIsReadOnly = owner?.read_only === 1;
      }

      if (ownerIsReadOnly) {
        return reply.send({ ok: true });
      }

      const id = nanoid();
      db.prepare(
        "INSERT INTO contact_messages (id, name, email, message, podcast_id, episode_id) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(id, name, email, message, podcastId, episodeId);

      if (
        (settings.email_provider === "smtp" ||
          settings.email_provider === "sendgrid") &&
        settings.email_enable_contact
      ) {
        const baseUrl =
          normalizeHostname(settings.hostname || "") || "http://localhost";
        const { subject, text, html } = buildContactNotificationEmail(
          baseUrl,
          name,
          email,
          message,
          {
            podcastTitle: podcastTitle ?? undefined,
            episodeTitle: episodeTitle ?? undefined,
          },
        );

        let recipients: string[] = [];
        if (podcastId) {
          const owner = db
            .prepare(
              `SELECT u.email FROM podcasts p
             INNER JOIN users u ON p.owner_user_id = u.id
             WHERE p.id = ? AND COALESCE(u.disabled, 0) = 0`,
            )
            .get(podcastId) as { email: string } | undefined;
          if (owner?.email?.trim()) {
            recipients = [owner.email.trim()];
          }
        }
        if (recipients.length === 0) {
          const adminRows = db
            .prepare(
              "SELECT email FROM users WHERE role = 'admin' AND COALESCE(disabled, 0) = 0",
            )
            .all() as Array<{ email: string }>;
          recipients = adminRows.map((r) => r.email).filter((e) => e?.trim());
        }

        for (const to of recipients) {
          const result = await sendMail({
            to,
            subject,
            text,
            html,
            replyTo: email,
          });
          if (!result.sent) {
            request.log.warn(
              { to, error: result.error },
              "Contact notification email failed",
            );
          }
        }
      }

      return reply.send({ ok: true });
    },
  );
}
