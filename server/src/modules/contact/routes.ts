import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { contactBodySchema } from "@harborfm/shared";
import { readSettings } from "../settings/index.js";
import { normalizeHostname } from "../../utils/url.js";
import { getClientIp } from "../../services/loginAttempts.js";
import { verifyCaptcha } from "../../services/captcha.js";
import { validateSubscriberTokenByValue } from "../../services/subscriberTokens.js";
import { sendMail, buildContactNotificationEmail } from "../../services/email.js";
import { SUBSCRIBER_TOKENS_COOKIE } from "../public/utils.js";
import {
  getPodcastIdAndTitleBySlug,
  getEpisodeIdAndTitleByPodcastAndSlug,
  isPodcastOwnerReadOnly,
  insertContactMessage,
  getContactRecipients,
} from "./repo.js";

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
          403: { description: "Subscriber-only messages: not authenticated as subscriber" },
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
      let subscriberOnlyMessages = false;

      if (podcastSlug) {
        const podcast = getPodcastIdAndTitleBySlug(podcastSlug);
        if (podcast) {
          podcastId = podcast.id;
          podcastTitle = podcast.title;
          subscriberOnlyMessages = podcast.subscriberOnlyMessages === 1;
          if (episodeSlug) {
            const episode = getEpisodeIdAndTitleByPodcastAndSlug(
              podcastId,
              episodeSlug,
            );
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

      if (subscriberOnlyMessages && podcastId && podcastSlug) {
        const cookies = (request as unknown as { cookies?: Record<string, string> }).cookies;
        const cookieVal = cookies?.[SUBSCRIBER_TOKENS_COOKIE];
        let tokenMap: Record<string, string> = {};
        if (cookieVal) {
          try {
            tokenMap = JSON.parse(cookieVal);
          } catch {
            // ignore
          }
        }
        const rawToken = tokenMap[podcastSlug];
        const tokenRow = rawToken ? validateSubscriberTokenByValue(rawToken) : null;
        if (!tokenRow || tokenRow.podcastId !== podcastId) {
          return reply.status(403).send({
            error:
              "Only subscribers can send messages for this show. Use your subscriber link to sign in.",
          });
        }
      }

      if (podcastId && isPodcastOwnerReadOnly(podcastId)) {
        return reply.send({ ok: true });
      }

      const id = nanoid();
      insertContactMessage({
        id,
        name,
        email,
        message,
        podcastId,
        episodeId,
      });

      if (
        (settings.email_provider === "smtp" ||
          settings.email_provider === "sendgrid" ||
          settings.email_provider === "webhook") &&
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

        const recipients = getContactRecipients(podcastId);

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
