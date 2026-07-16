import type { FastifyInstance } from "fastify";
import { episodeAlertSignupSchema } from "@harborfm/shared";
import {
  REVIEW_SUBMIT_RATE_LIMIT_MAX,
  REVIEW_SUBMIT_RATE_LIMIT_TIME_WINDOW,
} from "../../config.js";
import { readSettings } from "../settings/index.js";
import { getClientIp } from "../../services/loginAttempts.js";
import { verifyCaptcha } from "../../services/captcha.js";
import { sha256Hex } from "../../utils/hash.js";
import { getBaseUrl } from "../auth/shared.js";
import { ensurePublicFeedsEnabled } from "../public/utils.js";
import { getPodcastIdBySlug } from "../public/repo.js";
import * as repo from "./repo.js";
import { startSubscriberSignup, episodeAlertsEmailAvailable } from "./dispatch.js";
import {
  buildEpisodeAlertFeedUrl,
  getEpisodeAlertPublicOrigin,
} from "./publicUrls.js";

export async function registerEpisodeAlertPublicRoutes(app: FastifyInstance) {
  app.get(
    "/public/podcasts/:slug/episode-alerts",
    {
      schema: {
        tags: ["Public"],
        summary: "Public episode alerts availability for a show",
        security: [],
      },
    },
    async (request, reply) => {
      if (!ensurePublicFeedsEnabled(reply)) return;
      const { slug } = request.params as { slug: string };
      const podcastId = getPodcastIdBySlug(slug.trim());
      if (!podcastId) {
        return reply.code(404).send({ error: "Podcast not found" });
      }
      const settings = repo.getPodcastAlertSettings(podcastId);
      const emailAvailable = episodeAlertsEmailAvailable(podcastId);
      return reply.send({
        enabled: Boolean(settings?.episodeAlertsEnabled),
        emailSignupAvailable: emailAvailable,
        checkoutList: settings?.episodeAlertsCheckoutList ?? "subscribers",
      });
    },
  );

  app.post(
    "/public/podcasts/:slug/episode-alerts/signup",
    {
      config: {
        rateLimit: {
          max: REVIEW_SUBMIT_RATE_LIMIT_MAX,
          timeWindow: REVIEW_SUBMIT_RATE_LIMIT_TIME_WINDOW,
        },
      },
      schema: {
        tags: ["Public"],
        summary: "Sign up for episode alert emails (general list)",
        security: [],
      },
    },
    async (request, reply) => {
      if (!ensurePublicFeedsEnabled(reply)) return;
      const { slug } = request.params as { slug: string };
      const parsed = episodeAlertSignupSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "Invalid request", details: parsed.error.flatten() });
      }
      const podcastId = getPodcastIdBySlug(slug.trim());
      if (!podcastId) {
        return reply.code(404).send({ error: "Podcast not found" });
      }
      if (!episodeAlertsEmailAvailable(podcastId)) {
        return reply
          .code(400)
          .send({ error: "Email episode alerts are not available for this show" });
      }

      const settings = readSettings();
      if (settings.captcha_provider !== "none") {
        const ip = getClientIp(request);
        const verify = await verifyCaptcha(
          settings.captcha_provider,
          settings.captcha_secret_key,
          parsed.data.captchaToken ?? "",
          ip,
        );
        if (!verify.ok) {
          return reply.code(400).send({
            error: verify.error ?? "CAPTCHA verification failed",
          });
        }
      }

      const result = await startSubscriberSignup({
        podcastId,
        email: parsed.data.email,
        list: "general",
        source: "feed",
      });
      if (!result.ok) {
        return reply.code(400).send({ error: result.error });
      }
      // Uniform response: do not reveal whether the address was already on the list.
      return reply.send({
        ok: true,
        verificationRequired: true,
      });
    },
  );

  app.get(
    "/public/episode-alerts/verify",
    {
      schema: {
        tags: ["Public"],
        summary: "Verify episode alert email signup",
        security: [],
      },
    },
    async (request, reply) => {
      const { token } = request.query as { token?: string };
      const appBase = getBaseUrl();
      if (!token?.trim()) {
        return reply.redirect(`${appBase}/`);
      }
      const row = repo.findSubscriberByVerifyHash(sha256Hex(token.trim()));
      if (!row) {
        return reply.redirect(`${appBase}/?alerts=invalid`);
      }
      if (
        row.emailVerificationExpiresAt &&
        new Date(row.emailVerificationExpiresAt).getTime() < Date.now()
      ) {
        return reply.redirect(
          `${getEpisodeAlertPublicOrigin(row.podcastId)}/?alerts=expired`,
        );
      }
      repo.markSubscriberVerified(row.id);
      const slug = repo.getPodcastSlugById(row.podcastId);
      if (slug) {
        return reply.redirect(
          buildEpisodeAlertFeedUrl(row.podcastId, slug, "alerts=confirmed"),
        );
      }
      return reply.redirect(
        `${getEpisodeAlertPublicOrigin(row.podcastId)}/?alerts=confirmed`,
      );
    },
  );

  app.get(
    "/public/episode-alerts/unsubscribe",
    {
      schema: {
        tags: ["Public"],
        summary: "Unsubscribe from episode alert emails",
        security: [],
      },
    },
    async (request, reply) => {
      const { token } = request.query as { token?: string };
      const appBase = getBaseUrl();
      if (!token?.trim()) {
        return reply.redirect(`${appBase}/`);
      }
      const row = repo.findSubscriberByUnsubHash(sha256Hex(token.trim()));
      if (!row) {
        return reply.redirect(`${appBase}/?alerts=unsub-invalid`);
      }
      const slug = repo.getPodcastSlugById(row.podcastId);
      repo.deleteSubscriber(row.id);
      if (slug) {
        return reply.redirect(
          buildEpisodeAlertFeedUrl(row.podcastId, slug, "alerts=unsubscribed"),
        );
      }
      return reply.redirect(
        `${getEpisodeAlertPublicOrigin(row.podcastId)}/?alerts=unsubscribed`,
      );
    },
  );
}
