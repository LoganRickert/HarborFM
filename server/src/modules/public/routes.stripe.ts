import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { eq } from "drizzle-orm";
import {
  stripeCheckoutCreateSchema,
  stripeRecoverTokenSchema,
  stripeSubscriptionCancelSchema,
  stripeSubscriptionPortalSchema,
  stripeSubscriptionRegenerateSchema,
  stripeSubscriptionRenewSchema,
  stripeSubscriptionRequestRefundSchema,
} from "@harborfm/shared";
import { drizzleDb } from "../../db/drizzle.js";
import { podcasts } from "../../db/schema.js";
import { assertSafeId } from "../../services/paths.js";
import { API_PREFIX } from "../../config.js";
import {
  ensurePublicFeedsEnabled,
  SUBSCRIBER_TOKENS_COOKIE,
  COOKIE_MAX_AGE,
  getSubscriberCookieSecure,
} from "./utils.js";
import * as repo from "./repo.js";
import * as creds from "../stripe/credentials.js";
import * as plans from "../stripe/plans.js";
import * as coupons from "../stripe/coupons.js";
import * as checkout from "../stripe/checkout.js";
import * as webhooks from "../stripe/webhooks.js";
import * as subs from "../stripe/subscriptions.js";
import * as manage from "../stripe/manage.js";
import * as refundRequests from "../stripe/refundRequests.js";
import { createStripeClient, isE2eStripeSecret } from "../stripe/stripeClient.js";
import { validateSubscriberTokenByValue } from "../../services/subscriberTokens.js";
import {
  readSettings,
  isEmailProviderConfigured,
} from "../settings/index.js";
import { getBaseUrl } from "../auth/shared.js";
import {
  sendMail,
  buildSubscriberAccessTokenEmail,
} from "../../services/email.js";
import type Stripe from "stripe";

type RawBodyRequest = FastifyRequest & { rawBody?: Buffer };

function getPodcastBySlug(slug: string) {
  const podcastId = repo.getPodcastIdBySlug(slug);
  if (!podcastId) return null;
  const row = drizzleDb
    .select({
      id: podcasts.id,
      slug: podcasts.slug,
      title: podcasts.title,
      ownerUserId: podcasts.ownerUserId,
      stripeCredentialsId: podcasts.stripeCredentialsId,
      stripePaymentsEnabled: podcasts.stripePaymentsEnabled,
    })
    .from(podcasts)
    .where(eq(podcasts.id, podcastId))
    .limit(1)
    .get();
  return row ?? null;
}

function setSubscriberCookie(
  reply: FastifyReply,
  request: FastifyRequest,
  podcastSlug: string,
  rawToken: string,
) {
  const existingCookie = request.cookies[SUBSCRIBER_TOKENS_COOKIE];
  let tokenMap: Record<string, string> = {};
  if (existingCookie) {
    try {
      tokenMap = JSON.parse(existingCookie);
      if (typeof tokenMap !== "object" || Array.isArray(tokenMap)) {
        tokenMap = {};
      }
    } catch {
      tokenMap = {};
    }
  }
  tokenMap[podcastSlug] = rawToken;
  reply.setCookie(SUBSCRIBER_TOKENS_COOKIE, JSON.stringify(tokenMap), {
    httpOnly: true,
    secure: getSubscriberCookieSecure(),
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
}

async function buildSessionForFulfillment(opts: {
  sessionId: string;
  credentialsId: string;
  secretKey: string;
}): Promise<Stripe.Checkout.Session> {
  const pending = subs.getByCheckoutSessionId(opts.sessionId);
  if (isE2eStripeSecret(opts.secretKey) || opts.sessionId.startsWith("cs_e2e_")) {
    if (!pending) {
      throw Object.assign(new Error("Checkout session not found"), {
        statusCode: 404,
      });
    }
    const kind = pending.planId
      ? plans.getPlanById(pending.podcastId, pending.planId)?.kind
      : "month";
    const isOneTime = kind === "one_time";
    return {
      id: opts.sessionId,
      object: "checkout.session",
      mode: isOneTime ? "payment" : "subscription",
      status: "complete",
      payment_status: "paid",
      client_reference_id: pending.podcastId,
      customer: `cus_e2e_${pending.id}`,
      subscription: isOneTime ? null : `sub_e2e_${pending.id}`,
      payment_intent: isOneTime ? `pi_e2e_${pending.id}` : null,
      customer_email: "e2e@example.com",
      customer_details: { email: "e2e@example.com", name: null, phone: null, address: null, tax_exempt: null, tax_ids: null },
      metadata: {
        harborfm_podcast_id: pending.podcastId,
        harborfm_plan_id: pending.planId ?? "",
        harborfm_credentials_id: opts.credentialsId,
        harborfm_mode: pending.mode,
      },
    } as unknown as Stripe.Checkout.Session;
  }

  const stripe = createStripeClient(opts.secretKey);
  return stripe.checkout.sessions.retrieve(opts.sessionId);
}

export async function registerStripePublicRoutes(app: FastifyInstance) {
  app.get(
    "/public/podcasts/:podcastSlug/stripe/plans",
    {
      schema: {
        tags: ["Public"],
        summary: "List active Stripe plans for checkout",
        security: [],
      },
    },
    async (request, reply) => {
      if (!ensurePublicFeedsEnabled(reply)) return;
      const { podcastSlug } = request.params as { podcastSlug: string };
      const podcast = getPodcastBySlug(podcastSlug.trim());
      if (!podcast) {
        return reply.code(404).send({ error: "Podcast not found" });
      }
      const fields = creds.getPodcastStripeFields(podcast.id);
      if (
        !fields?.stripePaymentsEnabled ||
        !fields.stripeCredentialsId ||
        fields.stripeCheckoutPaused
      ) {
        return reply.send({
          enabled: false,
          mode: null,
          hasActiveCoupons: false,
          plans: [],
        });
      }
      const pack = creds.getById(fields.stripeCredentialsId);
      if (!pack || pack.ownerUserId !== fields.ownerUserId) {
        return reply.send({
          enabled: false,
          mode: null,
          hasActiveCoupons: false,
          plans: [],
        });
      }
      if (!creds.getActiveSecretKey(pack)) {
        return reply.send({
          enabled: false,
          mode: null,
          hasActiveCoupons: false,
          plans: [],
        });
      }
      const mode = (pack.mode === "live" ? "live" : "test") as "test" | "live";
      const rows = plans
        .listPlansForPodcast(podcast.id, mode)
        .filter((p) => p.active && p.stripePriceId);
      const hasActiveCoupons = coupons.hasActiveCouponsForPodcast(
        podcast.id,
        mode,
      );
      return reply.send({
        enabled: rows.length > 0,
        mode,
        hasActiveCoupons,
        plans: rows.map((p) => ({
          id: p.id,
          kind: p.kind,
          amountCents: p.amountCents,
          currency: p.currency,
          autoRenewDefault: Boolean(p.autoRenewDefault),
        })),
      });
    },
  );

  app.post(
    "/public/podcasts/:podcastSlug/stripe/checkout",
    {
      schema: {
        tags: ["Public"],
        summary: "Create a Stripe Checkout Session for a plan",
        security: [],
      },
    },
    async (request, reply) => {
      if (!ensurePublicFeedsEnabled(reply)) return;
      const { podcastSlug } = request.params as { podcastSlug: string };
      const parsed = stripeCheckoutCreateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid request", details: parsed.error.flatten() });
      }
      const podcast = getPodcastBySlug(podcastSlug.trim());
      if (!podcast) {
        return reply.code(404).send({ error: "Podcast not found" });
      }
      try {
        assertSafeId(parsed.data.planId, "planId");
        const result = await checkout.createCheckoutSession({
          podcastId: podcast.id,
          podcastSlug: podcast.slug,
          planId: parsed.data.planId,
          episodeAlerts: Boolean(parsed.data.episodeAlerts),
        });
        return reply.send({
          url: result.url,
          sessionId: result.sessionId,
          allowPromotionCodes: result.allowPromotionCodes,
        });
      } catch (err) {
        const status =
          err && typeof err === "object" && "statusCode" in err
            ? Number((err as { statusCode: number }).statusCode)
            : 500;
        return reply
          .code(status >= 400 && status < 600 ? status : 500)
          .send({ error: err instanceof Error ? err.message : "Checkout failed" });
      }
    },
  );

  app.get(
    "/public/podcasts/:podcastSlug/stripe/checkout/success",
    {
      schema: {
        tags: ["Public"],
        summary: "Complete checkout: issue subscriber token and set cookie",
        security: [],
        querystring: {
          type: "object",
          properties: { session_id: { type: "string" } },
          required: ["session_id"],
        },
      },
    },
    async (request, reply) => {
      if (!ensurePublicFeedsEnabled(reply)) return;
      const { podcastSlug } = request.params as { podcastSlug: string };
      const { session_id: sessionId } = request.query as { session_id?: string };
      if (!sessionId?.trim()) {
        return reply.code(400).send({ error: "session_id is required" });
      }
      const podcast = getPodcastBySlug(podcastSlug.trim());
      if (!podcast) {
        return reply.code(404).send({ error: "Podcast not found" });
      }
      const fields = creds.getPodcastStripeFields(podcast.id);
      if (!fields?.stripeCredentialsId) {
        return reply.code(400).send({ error: "Stripe is not configured for this show" });
      }
      const pack = creds.getById(fields.stripeCredentialsId);
      if (!pack) {
        return reply.code(400).send({ error: "Stripe account not found" });
      }
      const secretKey = creds.getActiveSecretKey(pack);
      if (!secretKey) {
        return reply.code(400).send({ error: "Stripe secret key is missing" });
      }

      try {
        const session = await buildSessionForFulfillment({
          sessionId: sessionId.trim(),
          credentialsId: pack.id,
          secretKey,
        });
        if (
          session.metadata?.harborfm_podcast_id &&
          session.metadata.harborfm_podcast_id !== podcast.id &&
          session.client_reference_id !== podcast.id
        ) {
          return reply.code(400).send({ error: "Session does not match this show" });
        }
        if (session.payment_status !== "paid" && session.status !== "complete") {
          return reply.code(402).send({ error: "Payment not completed" });
        }
        const { rawToken, subscriptionId } = await webhooks.fulfillCheckoutSession({
          credentialsId: pack.id,
          session,
          secretKey,
        });
        const firstReveal = subs.tryMarkAccessTokenRevealed(subscriptionId);
        if (firstReveal) {
          setSubscriberCookie(reply, request, podcast.slug, rawToken);
          return reply.send({
            success: true,
            podcastSlug: podcast.slug,
            token: rawToken,
            alreadyClaimed: false,
          });
        }
        return reply.send({
          success: true,
          podcastSlug: podcast.slug,
          token: null,
          alreadyClaimed: true,
        });
      } catch (err) {
        const status =
          err && typeof err === "object" && "statusCode" in err
            ? Number((err as { statusCode: number }).statusCode)
            : 500;
        return reply
          .code(status >= 400 && status < 600 ? status : 500)
          .send({
            error: err instanceof Error ? err.message : "Could not complete checkout",
          });
      }
    },
  );

  app.post(
    "/public/podcasts/:podcastSlug/stripe/recover-token",
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: "1 minute",
        },
      },
      schema: {
        tags: ["Public"],
        summary: "Email a subscriber their Stripe access token",
        security: [],
      },
    },
    async (request, reply) => {
      if (!ensurePublicFeedsEnabled(reply)) return;
      const { podcastSlug } = request.params as { podcastSlug: string };
      const parsed = stripeRecoverTokenSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Enter a valid email address" });
      }

      const settings = readSettings();
      if (!isEmailProviderConfigured(settings)) {
        return reply.code(503).send({
          error: "Email recovery is not available right now",
        });
      }

      const genericOk = {
        ok: true as const,
        message:
          "If we find a subscription for that email, we will send your access token shortly.",
      };

      const podcast = getPodcastBySlug(podcastSlug.trim());
      if (!podcast) {
        return reply.send(genericOk);
      }

      const email = parsed.data.email.trim().toLowerCase();
      try {
        manage.assertAndMarkCooldown(
          manage.lastRecoverTokenAt,
          `${podcast.id}:${email}`,
          manage.STRIPE_ACTION_COOLDOWN_MS,
          "request a token recovery email",
        );
      } catch (err) {
        const { status, message, retryAfterSec } = manageError(err);
        if (retryAfterSec) {
          reply.header("Retry-After", String(retryAfterSec));
        }
        return reply.code(status).send({ error: message });
      }

      const row = subs.getByPodcastAndCustomerEmail(podcast.id, email);
      if (!row?.accessTokenEnc) {
        return reply.send(genericOk);
      }

      const rawToken = subs.decryptAccessToken(row.accessTokenEnc);
      if (!rawToken || !validateSubscriberTokenByValue(rawToken)) {
        return reply.send(genericOk);
      }

      const baseUrl = getBaseUrl(settings);
      const slugEnc = encodeURIComponent(podcast.slug);
      const privateRssUrl = `${baseUrl}/${API_PREFIX}/public/podcasts/${slugEnc}/private/${encodeURIComponent(rawToken)}/rss`;
      const content = buildSubscriberAccessTokenEmail({
        baseUrl,
        podcastTitle: podcast.title || podcast.slug,
        rawToken,
        privateRssUrl,
      });

      await sendMail({
        to: email,
        subject: content.subject,
        text: content.text,
        html: content.html,
      });

      return reply.send(genericOk);
    },
  );

  function manageError(err: unknown): {
    status: number;
    message: string;
    retryAfterSec?: number;
  } {
    const status =
      err && typeof err === "object" && "statusCode" in err
        ? Number((err as { statusCode: number }).statusCode)
        : 500;
    const retryAfterSec =
      err && typeof err === "object" && "retryAfterSec" in err
        ? Number((err as { retryAfterSec: number }).retryAfterSec)
        : undefined;
    return {
      status: status >= 400 && status < 600 ? status : 500,
      message: err instanceof Error ? err.message : "Request failed",
      ...(Number.isFinite(retryAfterSec) && retryAfterSec! > 0
        ? { retryAfterSec: Math.ceil(retryAfterSec!) }
        : {}),
    };
  }

  app.get(
    "/public/podcasts/:podcastSlug/stripe/subscription/status",
    {
      schema: {
        tags: ["Public"],
        summary: "Get Stripe subscription status for the authenticated subscriber",
        security: [],
      },
    },
    async (request, reply) => {
      if (!ensurePublicFeedsEnabled(reply)) return;
      const { podcastSlug } = request.params as { podcastSlug: string };
      const podcast = getPodcastBySlug(podcastSlug.trim());
      if (!podcast) {
        return reply.code(404).send({ error: "Not found" });
      }
      const tokenParam =
        typeof (request.query as { token?: string }).token === "string"
          ? (request.query as { token?: string }).token
          : undefined;
      const ctx = manage.resolveManageContext({
        request,
        podcastId: podcast.id,
        podcastSlug: podcast.slug,
        bodyToken: tokenParam,
      });
      if (!ctx) {
        return reply.code(404).send({ error: "Not found" });
      }
      return reply.send(manage.getSubscriptionStatus(ctx));
    },
  );

  app.post(
    "/public/podcasts/:podcastSlug/stripe/subscription/portal",
    {
      schema: {
        tags: ["Public"],
        summary: "Create a Stripe Customer Portal session",
        security: [],
      },
    },
    async (request, reply) => {
      if (!ensurePublicFeedsEnabled(reply)) return;
      const { podcastSlug } = request.params as { podcastSlug: string };
      const parsed = stripeSubscriptionPortalSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid request" });
      }
      const podcast = getPodcastBySlug(podcastSlug.trim());
      if (!podcast) {
        return reply.code(404).send({ error: "Not found" });
      }
      const ctx = manage.resolveManageContext({
        request,
        podcastId: podcast.id,
        podcastSlug: podcast.slug,
        bodyToken: parsed.data.token,
      });
      if (!ctx) {
        return reply.code(404).send({ error: "Not found" });
      }
      try {
        const result = await manage.createBillingPortalSession({
          ctx,
          returnUrl: parsed.data.returnUrl,
          podcastSlug: podcast.slug,
        });
        return reply.send(result);
      } catch (err) {
        const { status, message } = manageError(err);
        return reply.code(status).send({ error: message });
      }
    },
  );

  app.post(
    "/public/podcasts/:podcastSlug/stripe/subscription/cancel-at-period-end",
    {
      schema: {
        tags: ["Public"],
        summary: "Schedule or undo cancel at period end",
        security: [],
      },
    },
    async (request, reply) => {
      if (!ensurePublicFeedsEnabled(reply)) return;
      const { podcastSlug } = request.params as { podcastSlug: string };
      const parsed = stripeSubscriptionCancelSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid request" });
      }
      const podcast = getPodcastBySlug(podcastSlug.trim());
      if (!podcast) {
        return reply.code(404).send({ error: "Not found" });
      }
      const ctx = manage.resolveManageContext({
        request,
        podcastId: podcast.id,
        podcastSlug: podcast.slug,
        bodyToken: parsed.data.token,
      });
      if (!ctx) {
        return reply.code(404).send({ error: "Not found" });
      }
      try {
        const result = await manage.setCancelAtPeriodEnd({
          ctx,
          cancel: parsed.data.cancel,
        });
        return reply.send(result);
      } catch (err) {
        const { status, message } = manageError(err);
        return reply.code(status).send({ error: message });
      }
    },
  );

  app.post(
    "/public/podcasts/:podcastSlug/stripe/subscription/renew",
    {
      schema: {
        tags: ["Public"],
        summary: "Resume auto-renew or open a renew/payment URL",
        security: [],
      },
    },
    async (request, reply) => {
      if (!ensurePublicFeedsEnabled(reply)) return;
      const { podcastSlug } = request.params as { podcastSlug: string };
      const parsed = stripeSubscriptionRenewSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid request" });
      }
      const podcast = getPodcastBySlug(podcastSlug.trim());
      if (!podcast) {
        return reply.code(404).send({ error: "Not found" });
      }
      const ctx = manage.resolveManageContext({
        request,
        podcastId: podcast.id,
        podcastSlug: podcast.slug,
        bodyToken: parsed.data.token,
      });
      if (!ctx) {
        return reply.code(404).send({ error: "Not found" });
      }
      try {
        const result = await manage.renewSubscription({
          ctx,
          podcastSlug: podcast.slug,
        });
        return reply.send(result);
      } catch (err) {
        const { status, message, retryAfterSec } = manageError(err);
        if (retryAfterSec) {
          reply.header("Retry-After", String(retryAfterSec));
        }
        return reply.code(status).send({ error: message });
      }
    },
  );

  app.post(
    "/public/podcasts/:podcastSlug/stripe/subscription/regenerate-token",
    {
      schema: {
        tags: ["Public"],
        summary: "Regenerate the subscriber access token",
        security: [],
      },
    },
    async (request, reply) => {
      if (!ensurePublicFeedsEnabled(reply)) return;
      const { podcastSlug } = request.params as { podcastSlug: string };
      const parsed = stripeSubscriptionRegenerateSchema.safeParse(
        request.body ?? {},
      );
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid request" });
      }
      const podcast = getPodcastBySlug(podcastSlug.trim());
      if (!podcast) {
        return reply.code(404).send({ error: "Not found" });
      }
      const ctx = manage.resolveManageContext({
        request,
        podcastId: podcast.id,
        podcastSlug: podcast.slug,
        bodyToken: parsed.data.token,
      });
      if (!ctx) {
        return reply.code(404).send({ error: "Not found" });
      }
      try {
        const token = manage.regenerateAccessToken(ctx);
        setSubscriberCookie(reply, request, podcast.slug, token);
        return reply.send({ token });
      } catch (err) {
        const { status, message, retryAfterSec } = manageError(err);
        if (retryAfterSec) {
          reply.header("Retry-After", String(retryAfterSec));
        }
        return reply.code(status).send({ error: message });
      }
    },
  );

  app.post(
    "/public/podcasts/:podcastSlug/stripe/subscription/request-refund",
    {
      schema: {
        tags: ["Public"],
        summary: "Request a refund for the current subscription",
        security: [],
      },
    },
    async (request, reply) => {
      if (!ensurePublicFeedsEnabled(reply)) return;
      const { podcastSlug } = request.params as { podcastSlug: string };
      const parsed = stripeSubscriptionRequestRefundSchema.safeParse(
        request.body ?? {},
      );
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid request" });
      }
      const podcast = getPodcastBySlug(podcastSlug.trim());
      if (!podcast) {
        return reply.code(404).send({ error: "Not found" });
      }
      const ctx = manage.resolveManageContext({
        request,
        podcastId: podcast.id,
        podcastSlug: podcast.slug,
        bodyToken: parsed.data.token,
      });
      if (!ctx) {
        return reply.code(404).send({ error: "Not found" });
      }
      try {
        const result = await refundRequests.createRefundRequest(ctx);
        return reply.send({ refundRequest: result });
      } catch (err) {
        const { status, message } = manageError(err);
        return reply.code(status).send({ error: message });
      }
    },
  );

  // Isolated plugin so the buffer JSON parser only applies to Stripe webhooks
  await app.register(async (webhookApp) => {
    webhookApp.addContentTypeParser(
      "application/json",
      { parseAs: "buffer" },
      (req, body, done) => {
        const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
        (req as RawBodyRequest).rawBody = buf;
        try {
          const json = JSON.parse(buf.toString("utf8")) as unknown;
          done(null, json);
        } catch (err) {
          done(err as Error, undefined);
        }
      },
    );

    webhookApp.post(
      "/public/stripe/webhook/:credentialsId",
      {
        schema: {
          tags: ["Public"],
          summary: "Stripe webhook for a credential pack",
          security: [],
        },
      },
      async (request, reply) => {
        const { credentialsId } = request.params as { credentialsId: string };
        try {
          assertSafeId(credentialsId, "credentialsId");
        } catch (err) {
          return reply
            .code(400)
            .send({ error: err instanceof Error ? err.message : "Invalid id" });
        }

        const pack = creds.getById(credentialsId);
        if (!pack) {
          return reply.code(404).send({ error: "Not found" });
        }
        const secretKey = creds.getActiveSecretKey(pack);
        const webhookSecret = creds.getActiveWebhookSecret(pack);
        if (!secretKey || !webhookSecret) {
          return reply.code(400).send({
            error:
              "Webhook not configured. Paste the whsec_ from `pnpm stripe:listen` into this account's Test webhook secret.",
          });
        }

        const rawBody = (request as RawBodyRequest).rawBody;
        if (!rawBody) {
          return reply.code(400).send({ error: "Missing raw body" });
        }

        try {
          const signature = request.headers["stripe-signature"];
          const event = webhooks.constructWebhookEvent({
            payload: rawBody,
            signature: typeof signature === "string" ? signature : undefined,
            webhookSecret,
            secretKey,
          });
          await webhooks.handleStripeEvent({
            credentialsId: pack.id,
            event,
            secretKey,
          });
          return reply.send({ received: true });
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Webhook error";
          const isSig =
            /signature/i.test(message) ||
            (err &&
              typeof err === "object" &&
              "type" in err &&
              String((err as { type: string }).type).includes("Signature"));
          request.log.warn({ err }, "Stripe webhook verification or handling failed");
          return reply.code(400).send({
            error: isSig
              ? "Webhook signature mismatch. Use the whsec_ printed by `pnpm stripe:listen` as this account's Test webhook secret (not a Dashboard endpoint secret)."
              : message,
          });
        }
      },
    );
  });
}
