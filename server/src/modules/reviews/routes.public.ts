import type { FastifyInstance, FastifyRequest } from "fastify";
import { randomBytes } from "crypto";
import { nanoid } from "nanoid";
import { reviewSubmitBodySchema } from "@harborfm/shared";
import {
  REVIEW_SUBMIT_RATE_LIMIT_MAX,
  REVIEW_SUBMIT_RATE_LIMIT_TIME_WINDOW,
} from "../../config.js";
import { readSettings } from "../settings/index.js";
import { getClientIp } from "../../services/loginAttempts.js";
import { verifyCaptcha } from "../../services/captcha.js";
import { sendMail, buildReviewVerificationEmail } from "../../services/email.js";
import { sha256Hex } from "../../utils/hash.js";
import { getPodcastIdBySlug } from "../public/repo.js";
import { getPublishedEpisodeBySlug } from "../public/repo.js";
import { SUBSCRIBER_TOKENS_COOKIE } from "../public/utils.js";
import { validateSubscriberTokenByValue } from "../../services/subscriberTokens.js";
import { spamCheckReview } from "../llm/utils.js";
import { askOllama, askOpenai, OPENAI_DEFAULT_MODEL } from "../llm/utils.js";
import { eq } from "drizzle-orm";
import { drizzleDb } from "../../db/index.js";
import { users } from "../../db/schema.js";
import {
  createReview,
  countReviewsByPodcastAndEmail,
  countReviewsByEpisodeAndEmail,
  getPodcastReviewSettings,
  getReviewById,
  findReviewByVerificationToken,
  findReviewByDeleteToken,
  setReviewVerified,
  setReviewHidden,
  listPublicReviews,
  getPodcastSlugById,
  getEpisodeSlugById,
} from "./repo.js";

function getBaseUrl(hostname: string): string {
  const raw = (hostname || "").trim().replace(/\/+$/, "");
  if (!raw) return "http://localhost";
  return raw.startsWith("http") ? raw : `https://${raw}`;
}

/** Optional auth: return userId, role, and user email/name if JWT valid. */
async function optionalAuth(request: FastifyRequest): Promise<{
  userId: string | null;
  userEmail: string | null;
  userName: string | null;
  role: string | null;
}> {
  try {
    await request.jwtVerify();
    const payload = request.user as { sub: string };
    const userId = payload.sub;
    const row = drizzleDb
      .select({ email: users.email, username: users.username, role: users.role })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
      .get();
    return {
      userId,
      userEmail: row?.email?.trim() ?? null,
      userName: row?.username?.trim() ?? null,
      role: row?.role?.trim() ?? null,
    };
  } catch {
    return { userId: null, userEmail: null, userName: null, role: null };
  }
}

export async function registerReviewPublicRoutes(app: FastifyInstance) {
  app.post(
    "/public/reviews",
    {
      config: {
        rateLimit: {
          max: REVIEW_SUBMIT_RATE_LIMIT_MAX,
          timeWindow: REVIEW_SUBMIT_RATE_LIMIT_TIME_WINDOW,
        },
      },
      schema: {
        tags: ["Public"],
        summary: "Submit a review",
        description:
          "Submit a podcast or episode review. CAPTCHA required when enabled. One review per email per podcast/episode.",
        security: [],
        body: {
          type: "object",
          required: ["podcastSlug", "name", "rating", "body"],
          properties: {
            podcastSlug: { type: "string" },
            episodeSlug: { type: "string" },
            name: { type: "string" },
            email: { type: "string" },
            rating: { type: "number" },
            body: { type: "string" },
            captchaToken: { type: "string" },
          },
        },
        response: {
          200: { description: "Review submitted" },
          400: { description: "Validation or duplicate" },
          403: { description: "Subscriber-only" },
          404: { description: "Podcast/episode not found" },
        },
      },
    },
    async (request, reply) => {
      const parsed = reviewSubmitBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: parsed.error.issues[0]?.message ?? "Validation failed",
          details: parsed.error.flatten(),
        });
      }
      const { podcastSlug, episodeSlug, name, email: bodyEmail, rating, body: bodyText, captchaToken } = parsed.data;

      const settings = readSettings();
      const reviewsEnabled = (settings as { reviews_enabled?: boolean }).reviews_enabled ?? true;
      if (!reviewsEnabled) {
        return reply.status(404).send({ error: "Not found" });
      }

      const podcastId = getPodcastIdBySlug(podcastSlug);
      if (!podcastId) {
        return reply.status(404).send({ error: "Podcast not found" });
      }

      let episodeId: string | null = null;
      if (episodeSlug) {
        const ep = getPublishedEpisodeBySlug(podcastId, episodeSlug);
        if (!ep) {
          return reply.status(404).send({ error: "Episode not found" });
        }
        episodeId = ep.id;
      }

      const podcastSettings = getPodcastReviewSettings(podcastId);
      if (!podcastSettings) {
        return reply.status(404).send({ error: "Podcast not found" });
      }

      if (podcastSettings.subscriberOnlyReviews) {
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
            error: "Only subscribers can leave reviews for this show. Use your subscriber link to sign in.",
          });
        }
      }

      const auth = await optionalAuth(request);
      const email: string =
        auth.userEmail ?? bodyEmail ?? "";
      const displayName = (name || "").trim() || (auth.userName ?? "Anonymous");

      if (!email.trim()) {
        return reply.status(400).send({ error: "Email is required when not signed in." });
      }

      if (episodeId) {
        const existing = countReviewsByEpisodeAndEmail(episodeId, email);
        if (existing > 0) {
          return reply.status(400).send({
            error: "You have already left a review for this episode.",
          });
        }
      } else {
        const existing = countReviewsByPodcastAndEmail(podcastId, email);
        if (existing > 0) {
          return reply.status(400).send({
            error: "You have already left a review for this podcast.",
          });
        }
      }

      if (settings.captcha_provider && settings.captcha_provider !== "none") {
        if (!captchaToken?.trim()) {
          return reply.status(400).send({
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
          return reply.status(400).send({
            error: verify.error ?? "CAPTCHA verification failed",
          });
        }
      }

      let spam = false;
      const llmSpamCheck = (settings as { reviews_llm_spam_check?: boolean }).reviews_llm_spam_check ?? false;
      if (llmSpamCheck && settings.llm_provider !== "none") {
        const model =
          (settings.model || "").trim() ||
          (settings.llm_provider === "openai" ? OPENAI_DEFAULT_MODEL : "llama3.2:latest");
        const askFn = async (prompt: string) => {
          if (settings.llm_provider === "ollama") {
            const base = (settings.ollama_url || "http://localhost:11434").trim().replace(/\/$/, "");
            return askOllama(base, model, prompt);
          }
          if (settings.llm_provider === "openai") {
            const apiKey = settings.openai_api_key?.trim();
            if (!apiKey) return "";
            return askOpenai(apiKey, model, prompt);
          }
          return "";
        };
        try {
          spam = await spamCheckReview(bodyText, askFn);
        } catch {
          // fail open
        }
      }

      const verified = Boolean(auth.userId);
      const approved = Boolean(auth.userId);

      let emailVerificationTokenHash: string | null = null;
      let emailVerificationExpiresAt: string | null = null;
      let rawToken: string | null = null;
      let deleteTokenHash: string | null = null;
      let deleteTokenExpiresAt: string | null = null;
      let rawDeleteToken: string | null = null;
      const emailEnabled =
        (settings.email_provider === "smtp" ||
          settings.email_provider === "sendgrid" ||
          settings.email_provider === "webhook") &&
        ((settings as { email_enable_review_verification?: boolean }).email_enable_review_verification ?? true);
      if (!verified && emailEnabled) {
        rawToken = randomBytes(32).toString("base64url");
        emailVerificationTokenHash = sha256Hex(rawToken);
        rawDeleteToken = randomBytes(32).toString("base64url");
        deleteTokenHash = sha256Hex(rawDeleteToken);
        const expires = new Date();
        expires.setFullYear(expires.getFullYear() + 1);
        emailVerificationExpiresAt = expires.toISOString();
        deleteTokenExpiresAt = expires.toISOString();
      }

      const id = nanoid();
      createReview({
        id,
        podcastId,
        episodeId,
        userId: auth.userId ?? null,
        name: displayName,
        email,
        rating,
        body: bodyText,
        verified,
        approved,
        spam,
        hidden: false,
        emailVerificationTokenHash,
        emailVerificationExpiresAt,
        deleteTokenHash,
        deleteTokenExpiresAt,
      });

      const verificationRequired = !verified && !!rawToken;
      if (rawToken && rawDeleteToken && emailEnabled) {
        const baseUrl = getBaseUrl(settings.hostname || "");
        const verifyParams = new URLSearchParams({
          token: rawToken,
          podcastSlug,
        });
        if (episodeSlug) verifyParams.set("episodeSlug", episodeSlug);
        const verifyUrl = `${baseUrl}/api/public/reviews/verify-email?${verifyParams.toString()}`;
        const deleteParams = new URLSearchParams({
          token: rawDeleteToken,
          podcastSlug,
        });
        if (episodeSlug) deleteParams.set("episodeSlug", episodeSlug);
        const deleteUrl = `${baseUrl}/api/public/reviews/delete?${deleteParams.toString()}`;
        const { subject, text, html } = buildReviewVerificationEmail(verifyUrl, deleteUrl);
        const sendResult = await sendMail({ to: email, subject, text, html });
        if (!sendResult.sent) {
          request.log.warn({ err: sendResult.error }, "Review verification email failed to send");
        }
      }

      return reply.send({ ok: true, id, verificationRequired: !!verificationRequired });
    },
  );

  app.get(
    "/public/reviews/verify-email",
    {
      schema: {
        tags: ["Public"],
        summary: "Verify review email",
        description:
          "Verifies the review and redirects to the podcast or episode feed page. On invalid/expired token, still redirects if podcastSlug (and optional episodeSlug) are in the query.",
        security: [],
        querystring: {
          type: "object",
          properties: {
            token: { type: "string" },
            podcastSlug: { type: "string" },
            episodeSlug: { type: "string" },
          },
        },
        response: { 302: { description: "Redirect to feed page" }, 400: { description: "Bad request" } },
      },
    },
    async (request, reply) => {
      const query = request.query as { token?: string; podcastSlug?: string; episodeSlug?: string };
      const token = query.token?.trim();
      const queryPodcastSlug = query.podcastSlug?.trim();
      const queryEpisodeSlug = query.episodeSlug?.trim();
      const settings = readSettings();
      const baseUrl = getBaseUrl(settings.hostname || "");

      function redirectToFeed(podcastSlug: string, episodeSlug?: string) {
        const feedPath = episodeSlug
          ? `/feed/${encodeURIComponent(podcastSlug)}/${encodeURIComponent(episodeSlug)}`
          : `/feed/${encodeURIComponent(podcastSlug)}`;
        return reply.redirect(`${baseUrl}${feedPath}`, 302);
      }

      if (token) {
        const tokenHash = sha256Hex(token);
        const review = findReviewByVerificationToken(tokenHash);
        if (review) {
          setReviewVerified(review.id);
          const fullReview = getReviewById(review.id);
          const podcastSlug =
            fullReview ? getPodcastSlugById(fullReview.podcastId) : getPodcastSlugById(review.podcastId);
          if (podcastSlug) {
            const episodeSlug =
              fullReview?.episodeId != null
                ? getEpisodeSlugById(String(fullReview.episodeId))
                : undefined;
            return redirectToFeed(podcastSlug, episodeSlug);
          }
        }
      }

      if (queryPodcastSlug) {
        return redirectToFeed(queryPodcastSlug, queryEpisodeSlug || undefined);
      }

      return reply.status(400).send({ error: "Missing token" });
    },
  );

  app.get(
    "/public/reviews/delete",
    {
      schema: {
        tags: ["Public"],
        summary: "Delete (hide) review via email link",
        description:
          "Hides the review and redirects to the podcast or episode feed page. On invalid/expired token, still redirects if podcastSlug (and optional episodeSlug) are in the query.",
        security: [],
        querystring: {
          type: "object",
          properties: {
            token: { type: "string" },
            podcastSlug: { type: "string" },
            episodeSlug: { type: "string" },
          },
        },
        response: { 302: { description: "Redirect to feed page" }, 400: { description: "Bad request" } },
      },
    },
    async (request, reply) => {
      const query = request.query as { token?: string; podcastSlug?: string; episodeSlug?: string };
      const token = query.token?.trim();
      const queryPodcastSlug = query.podcastSlug?.trim();
      const queryEpisodeSlug = query.episodeSlug?.trim();
      const settings = readSettings();
      const baseUrl = getBaseUrl(settings.hostname || "");

      function redirectToFeed(podcastSlug: string, episodeSlug?: string) {
        const feedPath = episodeSlug
          ? `/feed/${encodeURIComponent(podcastSlug)}/${encodeURIComponent(episodeSlug)}`
          : `/feed/${encodeURIComponent(podcastSlug)}`;
        return reply.redirect(`${baseUrl}${feedPath}`, 302);
      }

      if (token) {
        const tokenHash = sha256Hex(token);
        const review = findReviewByDeleteToken(tokenHash);
        if (review) {
          setReviewHidden(review.id);
          const fullReview = getReviewById(review.id);
          const podcastSlug =
            fullReview ? getPodcastSlugById(fullReview.podcastId) : getPodcastSlugById(review.podcastId);
          if (podcastSlug) {
            const episodeSlug =
              fullReview?.episodeId != null
                ? getEpisodeSlugById(String(fullReview.episodeId))
                : undefined;
            return redirectToFeed(podcastSlug, episodeSlug);
          }
        }
      }

      if (queryPodcastSlug) {
        return redirectToFeed(queryPodcastSlug, queryEpisodeSlug || undefined);
      }

      return reply.status(400).send({ error: "Missing token" });
    },
  );

  app.get(
    "/public/podcasts/:slug/reviews",
    {
      schema: {
        tags: ["Public"],
        summary: "List public reviews for a podcast or episode",
        security: [],
        params: { type: "object", properties: { slug: { type: "string" } }, required: ["slug"] },
        querystring: {
          type: "object",
          properties: {
            episodeSlug: { type: "string" },
            limit: { type: "string" },
            offset: { type: "string" },
          },
        },
        response: { 200: { description: "List of reviews" }, 404: { description: "Not found" } },
      },
    },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const query = request.query as { episodeSlug?: string; limit?: string; offset?: string };
      const podcastId = getPodcastIdBySlug(slug);
      if (!podcastId) {
        return reply.status(404).send({ error: "Podcast not found" });
      }
      let episodeId: string | null = null;
      if (query.episodeSlug?.trim()) {
        const ep = getPublishedEpisodeBySlug(podcastId, query.episodeSlug.trim());
        if (ep) episodeId = ep.id;
      }
      const settings = readSettings();
      const publishNonVerified =
        (settings as { reviews_publish_non_verified?: boolean }).reviews_publish_non_verified ?? false;
      const podcastSettings = getPodcastReviewSettings(podcastId);
      const allowUnapprovedReviews = podcastSettings?.allowUnapprovedReviews ?? true;
      const limit = Math.min(50, Math.max(1, parseInt(query.limit ?? "20", 10) || 20));
      const offset = Math.max(0, parseInt(query.offset ?? "0", 10) || 0);
      const rows = listPublicReviews({
        podcastId,
        episodeId,
        limit,
        offset,
        publishNonVerified,
        allowUnapprovedReviews,
      });
      const auth = await optionalAuth(request);
      const reviewsList = rows.map((r) => ({
        id: r.id,
        name: r.name,
        rating: r.rating,
        body: r.body,
        verified: r.verified,
        createdAt: r.createdAt,
        episodeTitle: r.episodeTitle,
        canDelete: Boolean(
          auth.userId && (r.userId === auth.userId || auth.role === "admin"),
        ),
      }));
      return reply.send({ reviews: reviewsList });
    },
  );

  app.delete(
    "/public/reviews/:reviewId",
    {
      schema: {
        tags: ["Public"],
        summary: "Delete (hide) own review or any review as admin",
        description:
          "Requires auth. Hides the review. Allowed if the current user is the review author or an admin.",
        security: [],
        params: {
          type: "object",
          required: ["reviewId"],
          properties: { reviewId: { type: "string" } },
        },
        response: {
          200: { description: "Review hidden" },
          401: { description: "Not signed in" },
          403: { description: "Forbidden" },
          404: { description: "Review not found" },
        },
      },
    },
    async (request, reply) => {
      const { reviewId } = request.params as { reviewId: string };
      const auth = await optionalAuth(request);
      if (!auth.userId) {
        return reply.status(401).send({ error: "Sign in to delete a review." });
      }
      const review = getReviewById(reviewId);
      if (!review) {
        return reply.status(404).send({ error: "Review not found." });
      }
      const canDelete =
        review.userId === auth.userId || auth.role === "admin";
      if (!canDelete) {
        return reply.status(403).send({ error: "You cannot delete this review." });
      }
      setReviewHidden(reviewId);
      return reply.send({ ok: true });
    },
  );
}
