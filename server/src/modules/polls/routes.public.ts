import type { FastifyInstance } from "fastify";
import { randomBytes } from "crypto";
import {
  pollVoteBodySchema,
  POLL_NO_OPTION_ID,
  POLL_SHORT_ANSWER_DEFAULT_MAX_LENGTH,
  POLL_YES_OPTION_ID,
  type PollQuestion,
} from "@harborfm/shared";
import {
  API_PREFIX,
  POLL_RESULTS_RATE_LIMIT_MAX,
  POLL_RESULTS_RATE_LIMIT_TIME_WINDOW,
  POLL_SUBMIT_RATE_LIMIT_MAX,
  POLL_SUBMIT_RATE_LIMIT_TIME_WINDOW,
} from "../../config.js";
import { readSettings } from "../settings/index.js";
import { getClientIp } from "../../services/loginAttempts.js";
import { verifyCaptcha } from "../../services/captcha.js";
import { sendMail, buildPollVerificationEmail } from "../../services/email.js";
import { sha256Hex } from "../../utils/hash.js";
import { getCookieSecureFlag } from "../../services/cookies.js";
import { getPodcastIdBySlug, getPublishedEpisodeBySlug } from "../public/repo.js";
import {
  aggregatePublicResults,
  createSubmission,
  findSubmissionByClientKey,
  findSubmissionByEmail,
  findSubmissionByIpHash,
  findSubmissionByVerificationToken,
  getPollByEpisodeId,
  isPollActiveNow,
  parseQuestionsJson,
  setSubmissionVerified,
} from "./repo.js";

export const POLL_VOTE_COOKIE_PREFIX = "hfm_poll_vote_";

function pollVoteCookieName(pollId: string): string {
  return `${POLL_VOTE_COOKIE_PREFIX}${pollId}`;
}

function getBaseUrl(hostname: string): string {
  const raw = (hostname || "").trim().replace(/\/+$/, "");
  if (!raw) return "http://localhost";
  return raw.startsWith("http") ? raw : `https://${raw}`;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function validateAnswers(
  questions: PollQuestion[],
  answers: Array<{ questionId: string; optionId?: string; textValue?: string }>,
): string | null {
  const byQ = new Map(answers.map((a) => [a.questionId, a]));
  for (const q of questions) {
    const a = byQ.get(q.id);
    if (!a) return `Missing answer for question`;
    if (q.type === "short_answer") {
      const text = (a.textValue ?? "").trim();
      if (!text) return "Short answer is required";
      const max = q.maxLength ?? POLL_SHORT_ANSWER_DEFAULT_MAX_LENGTH;
      if (text.length > max) return `Answer must be at most ${max} characters`;
      continue;
    }
    const optionId = a.optionId?.trim();
    if (!optionId) return "Please select an option";
    if (q.type === "yes_no") {
      if (optionId !== POLL_YES_OPTION_ID && optionId !== POLL_NO_OPTION_ID) {
        return "Invalid yes/no option";
      }
    } else if (q.type === "multiple_choice") {
      if (!q.options.some((o) => o.id === optionId)) return "Invalid option";
    }
  }
  return null;
}

export async function registerPollPublicRoutes(app: FastifyInstance) {
  app.get(
    "/public/podcasts/:slug/episodes/:epSlug/poll",
    {
      schema: {
        tags: ["Public"],
        summary: "Get active public poll for episode",
        security: [],
        params: {
          type: "object",
          properties: { slug: { type: "string" }, epSlug: { type: "string" } },
          required: ["slug", "epSlug"],
        },
        response: {
          200: { description: "Poll" },
          404: { description: "Not found or inactive" },
        },
      },
    },
    async (request, reply) => {
      const { slug, epSlug } = request.params as { slug: string; epSlug: string };
      const settings = readSettings();
      if (!settings.public_feeds_enabled) {
        return reply.status(404).send({ error: "Not found" });
      }
      const podcastId = getPodcastIdBySlug(slug);
      if (!podcastId) return reply.status(404).send({ error: "Not found" });
      const episode = getPublishedEpisodeBySlug(podcastId, epSlug);
      if (!episode) return reply.status(404).send({ error: "Not found" });
      const poll = getPollByEpisodeId(episode.id);
      if (!poll || !isPollActiveNow(poll)) {
        return reply.status(404).send({ error: "Not found" });
      }
      const questions = parseQuestionsJson(poll.questionsJson);
      if (questions.length === 0) {
        return reply.status(404).send({ error: "Not found" });
      }
      const cookieVal = (request.cookies as Record<string, string | undefined>)?.[
        pollVoteCookieName(poll.id)
      ];
      const alreadyVoted = Boolean(
        cookieVal && findSubmissionByClientKey(poll.id, cookieVal),
      );
      return reply.send({
        id: poll.id,
        requireEmail: Boolean(poll.requireEmail),
        publicResults: Boolean(poll.publicResults),
        questions,
        alreadyVoted,
      });
    },
  );

  app.post(
    "/public/podcasts/:slug/episodes/:epSlug/poll/vote",
    {
      config: {
        rateLimit: {
          max: POLL_SUBMIT_RATE_LIMIT_MAX,
          timeWindow: POLL_SUBMIT_RATE_LIMIT_TIME_WINDOW,
        },
      },
      schema: {
        tags: ["Public"],
        summary: "Submit poll vote",
        security: [],
        params: {
          type: "object",
          properties: { slug: { type: "string" }, epSlug: { type: "string" } },
          required: ["slug", "epSlug"],
        },
        response: {
          200: { description: "Vote accepted" },
          400: { description: "Invalid" },
          404: { description: "Not found" },
          409: { description: "Already voted" },
        },
      },
    },
    async (request, reply) => {
      const { slug, epSlug } = request.params as { slug: string; epSlug: string };
      const settings = readSettings();
      if (!settings.public_feeds_enabled) {
        return reply.status(404).send({ error: "Not found" });
      }
      const parsed = pollVoteBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: parsed.error.issues[0]?.message ?? "Invalid body",
        });
      }
      const podcastId = getPodcastIdBySlug(slug);
      if (!podcastId) return reply.status(404).send({ error: "Not found" });
      const episode = getPublishedEpisodeBySlug(podcastId, epSlug);
      if (!episode) return reply.status(404).send({ error: "Not found" });
      const poll = getPollByEpisodeId(episode.id);
      if (!poll || !isPollActiveNow(poll)) {
        return reply.status(404).send({ error: "Poll is not active" });
      }
      const questions = parseQuestionsJson(poll.questionsJson);
      if (questions.length === 0) {
        return reply.status(404).send({ error: "Poll is not active" });
      }

      const cookieName = pollVoteCookieName(poll.id);
      const existingCookie = (request.cookies as Record<string, string | undefined>)?.[cookieName];
      if (existingCookie && findSubmissionByClientKey(poll.id, existingCookie)) {
        const payload: Record<string, unknown> = {
          ok: true,
          alreadyVoted: true,
          verificationRequired: false,
        };
        if (poll.publicResults) {
          payload.results = aggregatePublicResults(poll);
        }
        return reply.status(200).send(payload);
      }

      if (settings.captcha_provider && settings.captcha_provider !== "none") {
        if (!parsed.data.captchaToken) {
          return reply.status(400).send({ error: "Captcha is required" });
        }
        const captchaOk = await verifyCaptcha(
          settings.captcha_provider as "recaptcha_v2" | "recaptcha_v3" | "hcaptcha",
          settings.captcha_secret_key,
          parsed.data.captchaToken,
          getClientIp(request),
        );
        if (!captchaOk.ok) {
          return reply.status(400).send({ error: captchaOk.error ?? "Captcha verification failed" });
        }
      }

      if (poll.requireEmail && !parsed.data.email) {
        return reply.status(400).send({ error: "Email is required" });
      }

      const ip = getClientIp(request);
      const ipHash = ip ? sha256Hex(ip) : null;

      if (poll.limitOneVotePerIp && ipHash) {
        if (findSubmissionByIpHash(poll.id, ipHash)) {
          return reply.status(409).send({ error: "You have already voted from this network" });
        }
      }

      let emailNormalized: string | null = null;
      if (parsed.data.email) {
        emailNormalized = normalizeEmail(parsed.data.email);
        if (findSubmissionByEmail(poll.id, emailNormalized)) {
          return reply.status(409).send({ error: "This email has already voted" });
        }
      }

      const answerErr = validateAnswers(questions, parsed.data.answers);
      if (answerErr) return reply.status(400).send({ error: answerErr });

      const clientKey = randomBytes(24).toString("base64url");
      let verificationRequired = false;
      let emailVerificationTokenHash: string | null = null;
      let emailVerificationExpiresAt: string | null = null;
      let rawVerifyToken: string | null = null;

      const verified = !poll.requireEmail;
      if (poll.requireEmail && parsed.data.email) {
        verificationRequired = true;
        rawVerifyToken = randomBytes(32).toString("base64url");
        emailVerificationTokenHash = sha256Hex(rawVerifyToken);
        const expires = new Date();
        expires.setFullYear(expires.getFullYear() + 1);
        emailVerificationExpiresAt = expires.toISOString();
      }

      try {
        createSubmission({
          pollId: poll.id,
          episodeId: episode.id,
          email: parsed.data.email ?? null,
          emailNormalized,
          verified,
          emailVerificationTokenHash,
          emailVerificationExpiresAt,
          ipHash,
          clientKey,
          answers: parsed.data.answers.map((a) => ({
            questionId: a.questionId,
            optionId: a.optionId ?? null,
            textValue: a.textValue?.trim() || null,
          })),
        });
      } catch (err) {
        return reply.status(409).send({
          error: err instanceof Error ? err.message : "Could not save vote",
        });
      }

      if (verificationRequired && rawVerifyToken && parsed.data.email) {
        const base = getBaseUrl(settings.hostname || "");
        const verifyUrl = `${base}/${API_PREFIX}/public/podcasts/${encodeURIComponent(slug)}/episodes/${encodeURIComponent(epSlug)}/poll/verify-email?token=${encodeURIComponent(rawVerifyToken)}`;
        try {
          const { subject, text, html } = buildPollVerificationEmail(verifyUrl);
          await sendMail({ to: parsed.data.email, subject, text, html });
        } catch {
          // Vote is already stored; verification email failure is non-fatal.
        }
      }

      reply.setCookie(cookieName, clientKey, {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: getCookieSecureFlag(),
        maxAge: 60 * 60 * 24 * 365,
      });

      const payload: Record<string, unknown> = {
        ok: true,
        alreadyVoted: false,
        verificationRequired,
      };
      if (poll.publicResults) {
        payload.results = aggregatePublicResults(poll);
      }
      return reply.send(payload);
    },
  );

  app.get(
    "/public/podcasts/:slug/episodes/:epSlug/poll/verify-email",
    {
      schema: {
        tags: ["Public"],
        summary: "Verify poll voter email",
        security: [],
        params: {
          type: "object",
          properties: { slug: { type: "string" }, epSlug: { type: "string" } },
          required: ["slug", "epSlug"],
        },
        querystring: {
          type: "object",
          properties: { token: { type: "string" } },
        },
        response: {
          302: { description: "Redirect to episode" },
        },
      },
    },
    async (request, reply) => {
      const { slug, epSlug } = request.params as { slug: string; epSlug: string };
      const { token } = request.query as { token?: string };
      if (token) {
        const submission = findSubmissionByVerificationToken(sha256Hex(token));
        if (submission) {
          setSubmissionVerified(submission.id);
        }
      }
      const feedPath = `/feed/${encodeURIComponent(slug)}/${encodeURIComponent(epSlug)}`;
      const settings = readSettings();
      const base = getBaseUrl(settings.hostname || "");
      return reply.redirect(`${base}${feedPath}`, 302);
    },
  );

  app.get(
    "/public/podcasts/:slug/episodes/:epSlug/poll/results",
    {
      config: {
        rateLimit: {
          max: POLL_RESULTS_RATE_LIMIT_MAX,
          timeWindow: POLL_RESULTS_RATE_LIMIT_TIME_WINDOW,
        },
      },
      schema: {
        tags: ["Public"],
        summary: "Get public poll results (percentages only)",
        security: [],
        params: {
          type: "object",
          properties: { slug: { type: "string" }, epSlug: { type: "string" } },
          required: ["slug", "epSlug"],
        },
        response: {
          200: { description: "Results" },
          404: { description: "Not found or not public" },
        },
      },
    },
    async (request, reply) => {
      const { slug, epSlug } = request.params as { slug: string; epSlug: string };
      const settings = readSettings();
      if (!settings.public_feeds_enabled) {
        return reply.status(404).send({ error: "Not found" });
      }
      const podcastId = getPodcastIdBySlug(slug);
      if (!podcastId) return reply.status(404).send({ error: "Not found" });
      const episode = getPublishedEpisodeBySlug(podcastId, epSlug);
      if (!episode) return reply.status(404).send({ error: "Not found" });
      const poll = getPollByEpisodeId(episode.id);
      if (!poll) return reply.status(404).send({ error: "Not found" });

      const cookieVal = (request.cookies as Record<string, string | undefined>)?.[
        pollVoteCookieName(poll.id)
      ];
      const hasVoted = Boolean(
        cookieVal && findSubmissionByClientKey(poll.id, cookieVal),
      );
      if (!poll.publicResults && !hasVoted) {
        return reply.status(404).send({ error: "Not found" });
      }
      // Active or ended (ended polls can still show public results)
      if (!poll.enabled && !hasVoted) {
        return reply.status(404).send({ error: "Not found" });
      }
      return reply.send(aggregatePublicResults(poll));
    },
  );
}
