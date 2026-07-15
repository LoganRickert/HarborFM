import { nanoid } from "nanoid";
import type Stripe from "stripe";
import type { StripePlanKind } from "@harborfm/shared";
import { getBaseUrl } from "../auth/shared.js";
import * as creds from "./credentials.js";
import * as plans from "./plans.js";
import * as coupons from "./coupons.js";
import * as subs from "./subscriptions.js";
import { createStripeClient, isE2eStripeSecret } from "./stripeClient.js";

export type CheckoutResult = {
  sessionId: string;
  url: string;
  allowPromotionCodes: boolean;
};

function assertCheckoutReady(podcastId: string, planId: string) {
  const podcast = creds.getPodcastStripeFields(podcastId);
  if (!podcast?.stripePaymentsEnabled || !podcast.stripeCredentialsId) {
    throw Object.assign(new Error("Stripe payments are not enabled for this show"), {
      statusCode: 400,
    });
  }
  const pack = creds.getById(podcast.stripeCredentialsId);
  if (!pack || pack.ownerUserId !== podcast.ownerUserId) {
    throw Object.assign(new Error("Stripe account is not available for this show"), {
      statusCode: 400,
    });
  }
  const secretKey = creds.getActiveSecretKey(pack);
  if (!secretKey) {
    throw Object.assign(new Error("Stripe secret key is missing"), {
      statusCode: 400,
    });
  }
  const mode = (pack.mode === "live" ? "live" : "test") as "test" | "live";
  const plan = plans.getPlanById(podcastId, planId);
  if (!plan || !plan.active) {
    throw Object.assign(new Error("Plan not found"), { statusCode: 404 });
  }
  if ((plan.mode === "live" ? "live" : "test") !== mode) {
    throw Object.assign(new Error("Plan is not available in the current Stripe mode"), {
      statusCode: 400,
    });
  }
  if (!plan.stripePriceId) {
    throw Object.assign(new Error("Plan is not synced with Stripe yet"), {
      statusCode: 400,
    });
  }
  return { podcast, pack, secretKey, mode, plan };
}

export async function createCheckoutSession(opts: {
  podcastId: string;
  podcastSlug: string;
  planId: string;
}): Promise<CheckoutResult> {
  const { podcast, pack, secretKey, mode, plan } = assertCheckoutReady(
    opts.podcastId,
    opts.planId,
  );
  const kind = plan.kind as StripePlanKind;
  const checkoutMode = kind === "one_time" ? "payment" : "subscription";
  const base = getBaseUrl();
  const successUrl = `${base}/feed/${encodeURIComponent(opts.podcastSlug)}/subscribe/success?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${base}/feed/${encodeURIComponent(opts.podcastSlug)}`;

  const metadata = {
    harborfm_podcast_id: opts.podcastId,
    harborfm_plan_id: plan.id,
    harborfm_credentials_id: pack.id,
    harborfm_mode: mode,
  };

  const allowPromotionCodes = coupons.hasActiveCouponsForPodcast(
    opts.podcastId,
    mode,
  );

  if (isE2eStripeSecret(secretKey)) {
    const sessionId = `cs_e2e_${nanoid(16)}`;
    // Pending row so success/webhook fulfillment can resolve plan + podcast
    subs.insertSubscription({
      podcastId: opts.podcastId,
      stripeCredentialsId: pack.id,
      mode,
      planId: plan.id,
      subscriberTokenId: null,
      stripeCustomerId: "",
      stripeSubscriptionId: null,
      stripeCheckoutSessionId: sessionId,
      stripePaymentIntentId: null,
      status: "incomplete",
      currentPeriodEnd: null,
      customerEmail: null,
      accessTokenEnc: null,
    });
    const promoQs = allowPromotionCodes ? "&allow_promotion_codes=1" : "";
    return {
      sessionId,
      url: `${successUrl.replace("{CHECKOUT_SESSION_ID}", sessionId)}&e2e=1${promoQs}`,
      allowPromotionCodes,
    };
  }

  const stripe = createStripeClient(secretKey);
  const params: Stripe.Checkout.SessionCreateParams = {
    mode: checkoutMode,
    line_items: [{ price: plan.stripePriceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    client_reference_id: opts.podcastId,
    metadata,
    allow_promotion_codes: allowPromotionCodes || undefined,
  };

  if (checkoutMode === "subscription") {
    const subscriptionData: Stripe.Checkout.SessionCreateParams.SubscriptionData =
      {
        metadata,
      };
    // Align renewals to the 1st of the month (Stripe prorates the stub period by default).
    if (podcast.billingAnchor === "month_start") {
      subscriptionData.billing_cycle_anchor_config = { day_of_month: 1 };
    }
    params.subscription_data = subscriptionData;
  } else {
    params.payment_intent_data = {
      metadata,
    };
  }

  const session = await stripe.checkout.sessions.create(params);
  if (!session.url) {
    throw Object.assign(new Error("Stripe did not return a checkout URL"), {
      statusCode: 502,
    });
  }
  return {
    sessionId: session.id,
    url: session.url,
    allowPromotionCodes,
  };
}
