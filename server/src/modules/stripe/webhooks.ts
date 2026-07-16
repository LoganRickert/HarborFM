import type Stripe from "stripe";
import { SUBSCRIBER_TOKEN_PREFIX } from "../../config.js";
import {
  createSubscriberToken,
  setSubscriberTokenDisabled,
  setSubscriberTokenValidUntil,
} from "../../services/subscriberTokens.js";
import * as creds from "./credentials.js";
import * as plans from "./plans.js";
import * as coupons from "./coupons.js";
import * as subs from "./subscriptions.js";
import * as notify from "./notify.js";
import * as refundRequests from "./refundRequests.js";
import { createStripeClient, isE2eStripeSecret } from "./stripeClient.js";

export { subscriptionGrantsAccess } from "./subscriptions.js";
import { subscriptionGrantsAccess } from "./subscriptions.js";

function periodEndIso(unixSeconds: number | null | undefined): string | null {
  if (unixSeconds == null || !Number.isFinite(unixSeconds)) return null;
  return new Date(unixSeconds * 1000).toISOString();
}

function subscriptionPeriodEnd(sub: Stripe.Subscription): string | null {
  const fromItem = sub.items?.data?.[0]?.current_period_end;
  if (fromItem != null) return periodEndIso(fromItem);
  const legacy = (sub as { current_period_end?: number }).current_period_end;
  return periodEndIso(legacy);
}

function idOrNull(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "object" && "id" in value && typeof value.id === "string") {
    return value.id.trim() || null;
  }
  return null;
}

function discountIdsFromSession(session: Stripe.Checkout.Session): {
  promotionCodeId: string | null;
  couponId: string | null;
} {
  const first = session.discounts?.[0];
  if (!first) {
    // E2E / metadata fallback
    const metaPromo = session.metadata?.harborfm_promo_code_id?.trim();
    const metaCoupon = session.metadata?.harborfm_stripe_coupon_id?.trim();
    return {
      promotionCodeId: metaPromo || null,
      couponId: metaCoupon || null,
    };
  }
  return {
    promotionCodeId: idOrNull(first.promotion_code),
    couponId: idOrNull(first.coupon),
  };
}

/** True when Stripe has scheduled the subscription to end (portal often uses cancel_at). */
function isCancelScheduled(sub: Stripe.Subscription): boolean {
  return Boolean(sub.cancel_at_period_end) || typeof sub.cancel_at === "number";
}

/** Access / billing end for a scheduled cancellation. Prefer cancel_at when set. */
function subscriptionCancelEnd(sub: Stripe.Subscription): string | null {
  if (typeof sub.cancel_at === "number") return periodEndIso(sub.cancel_at);
  return subscriptionPeriodEnd(sub);
}

/**
 * Whether the subscription was already scheduled to cancel before this update.
 * Returns null when previous_attributes does not mention cancel fields.
 */
function wasCancelScheduled(
  prev: Record<string, unknown> | undefined,
): boolean | null {
  if (!prev) return null;
  let known = false;
  let was = false;
  if ("cancel_at_period_end" in prev) {
    known = true;
    was = was || Boolean(prev.cancel_at_period_end);
  }
  if ("cancel_at" in prev) {
    known = true;
    was = was || typeof prev.cancel_at === "number";
  }
  return known ? was : null;
}

function invoicePeriodEnd(invoice: Stripe.Invoice): string | null {
  const lines = invoice.lines?.data;
  if (Array.isArray(lines)) {
    for (const line of lines) {
      const end = line.period?.end;
      if (typeof end === "number") return periodEndIso(end);
    }
  }
  const legacy = (invoice as { period_end?: number }).period_end;
  return periodEndIso(legacy);
}

function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const nested = invoice.parent?.subscription_details?.subscription;
  if (typeof nested === "string") return nested;
  if (nested && typeof nested === "object" && "id" in nested) {
    return nested.id;
  }
  const legacy = (invoice as { subscription?: string | { id: string } | null })
    .subscription;
  if (typeof legacy === "string") return legacy;
  if (legacy && typeof legacy === "object") return legacy.id;
  return null;
}

function customerIdFrom(session: Stripe.Checkout.Session): string {
  if (typeof session.customer === "string") return session.customer;
  if (session.customer && typeof session.customer === "object") {
    return session.customer.id;
  }
  return "";
}

function subscriptionIdFrom(session: Stripe.Checkout.Session): string | null {
  if (typeof session.subscription === "string") return session.subscription;
  if (session.subscription && typeof session.subscription === "object") {
    return session.subscription.id;
  }
  return null;
}

function paymentIntentIdFrom(session: Stripe.Checkout.Session): string | null {
  if (typeof session.payment_intent === "string") return session.payment_intent;
  if (session.payment_intent && typeof session.payment_intent === "object") {
    return session.payment_intent.id;
  }
  return null;
}

/**
 * Provision subscriber token for a paid Checkout Session (idempotent).
 * Sends a welcome email only when a new token is created.
 */
export async function fulfillCheckoutSession(opts: {
  credentialsId: string;
  session: Stripe.Checkout.Session;
  secretKey: string;
}): Promise<{ rawToken: string; subscriptionId: string }> {
  const { credentialsId, session, secretKey } = opts;
  const existing = session.id
    ? subs.getByCheckoutSessionId(session.id)
    : undefined;
  if (existing?.subscriberTokenId && existing.accessTokenEnc) {
    const raw = subs.decryptAccessToken(existing.accessTokenEnc);
    if (raw) {
      return { rawToken: raw, subscriptionId: existing.id };
    }
  }

  const podcastId =
    session.metadata?.harborfm_podcast_id ||
    session.client_reference_id ||
    "";
  const planId = session.metadata?.harborfm_plan_id || "";
  if (!podcastId) {
    throw new Error("Checkout session missing harborfm_podcast_id");
  }

  const pack = creds.getById(credentialsId);
  if (!pack) throw new Error("Stripe credentials not found");
  const mode = (pack.mode === "live" ? "live" : "test") as "test" | "live";

  const plan = planId ? plans.getPlanById(podcastId, planId) : undefined;
  const kind = plan?.kind ?? (session.mode === "payment" ? "one_time" : "month");
  const isOneTime = kind === "one_time" || session.mode === "payment";

  let currentPeriodEnd: string | null = null;
  const stripeSubId = subscriptionIdFrom(session);
  if (!isOneTime && stripeSubId) {
    if (isE2eStripeSecret(secretKey)) {
      // E2E has no Stripe retrieve; seed a period so renewal / expiry tests work.
      currentPeriodEnd = new Date(Date.now() + 30 * 86400 * 1000).toISOString();
    } else {
      try {
        const stripe = createStripeClient(secretKey);
        const sub = await stripe.subscriptions.retrieve(stripeSubId);
        currentPeriodEnd = subscriptionPeriodEnd(sub);
      } catch {
        /* ignore - token still created */
      }
    }
  }

  const email =
    session.customer_details?.email ||
    session.customer_email ||
    null;
  const tokenName = email
    ? `Stripe (${email})`
    : `Stripe ${isOneTime ? "purchase" : "subscription"}`;

  const { id: tokenId, rawToken } = createSubscriberToken({
    podcastId,
    name: tokenName,
    validUntil: isOneTime ? null : currentPeriodEnd,
    tokenPrefix: SUBSCRIBER_TOKEN_PREFIX,
  });

  const status = isOneTime ? "one_time" : "active";
  const accessTokenEnc = subs.encryptAccessToken(rawToken);
  const amountPaidCents =
    typeof session.amount_total === "number" && Number.isFinite(session.amount_total)
      ? session.amount_total
      : null;

  let subscriptionId: string;
  if (existing) {
    subs.updateSubscription(existing.id, {
      subscriberTokenId: tokenId,
      stripeCustomerId: customerIdFrom(session) || existing.stripeCustomerId,
      stripeSubscriptionId: stripeSubId,
      stripePaymentIntentId: paymentIntentIdFrom(session),
      status,
      currentPeriodEnd,
      customerEmail: email,
      accessTokenEnc,
      amountPaidCents:
        amountPaidCents !== null ? amountPaidCents : existing.amountPaidCents,
    });
    subscriptionId = existing.id;
  } else {
    const row = subs.insertSubscription({
      podcastId,
      stripeCredentialsId: credentialsId,
      mode,
      planId: planId || null,
      subscriberTokenId: tokenId,
      stripeCustomerId: customerIdFrom(session),
      stripeSubscriptionId: stripeSubId,
      stripeCheckoutSessionId: session.id,
      stripePaymentIntentId: paymentIntentIdFrom(session),
      status,
      currentPeriodEnd,
      customerEmail: email,
      accessTokenEnc,
      amountPaidCents,
    });
    subscriptionId = row.id;
  }

  const { promotionCodeId, couponId: stripeCouponId } =
    discountIdsFromSession(session);
  let localCoupon =
    (promotionCodeId
      ? coupons.getCouponByStripePromotionCodeId(podcastId, promotionCodeId)
      : undefined) ??
    (stripeCouponId
      ? coupons.getCouponByStripeCouponId(podcastId, stripeCouponId)
      : undefined);

  // E2E: metadata harborfm_coupon_id points at local coupon id
  if (!localCoupon && session.metadata?.harborfm_coupon_id) {
    localCoupon = coupons.getCouponById(
      podcastId,
      session.metadata.harborfm_coupon_id,
    );
  }

  if (localCoupon) {
    const amountDiscount =
      typeof session.total_details?.amount_discount === "number"
        ? session.total_details.amount_discount
        : null;
    coupons.recordRedemption({
      couponId: localCoupon.id,
      subscriptionId,
      podcastId,
      customerEmail: email,
      stripeCheckoutSessionId: session.id,
      stripePromotionCodeId:
        promotionCodeId || localCoupon.stripePromotionCodeId || null,
      stripeCouponId: stripeCouponId || localCoupon.stripeCouponId || null,
      amountOffCents:
        amountDiscount ??
        (localCoupon.discountType === "amount"
          ? localCoupon.amountOffCents
          : null),
      percentOff:
        localCoupon.discountType === "percent" ? localCoupon.percentOff : null,
    });
  }

  await notify.notifyWelcome({
    podcastId,
    customerEmail: email,
    rawToken,
  });

  if (session.metadata?.harborfm_episode_alerts === "1" && email?.trim()) {
    try {
      const { startSubscriberSignup } = await import("../episodeAlerts/index.js");
      const { getPodcastAlertSettings } = await import(
        "../episodeAlerts/repo.js"
      );
      const alertSettings = getPodcastAlertSettings(podcastId);
      if (alertSettings?.episodeAlertsEnabled) {
        await startSubscriberSignup({
          podcastId,
          email: email.trim(),
          list: alertSettings.episodeAlertsCheckoutList,
          source: "checkout",
        });
      }
    } catch (err) {
      console.warn(
        "[episodeAlerts] checkout signup failed:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  return { rawToken, subscriptionId };
}

export function syncSubscriptionStatus(opts: {
  stripeSubscriptionId: string;
  status: string;
  currentPeriodEnd?: string | null;
  cancelAtPeriodEnd?: boolean;
  disableToken?: boolean;
  enableToken?: boolean;
}): void {
  const row = subs.getByStripeSubscriptionId(opts.stripeSubscriptionId);
  if (!row) return;

  subs.updateSubscription(row.id, {
    status: opts.status,
    currentPeriodEnd:
      opts.currentPeriodEnd !== undefined
        ? opts.currentPeriodEnd
        : row.currentPeriodEnd,
    cancelAtPeriodEnd:
      opts.cancelAtPeriodEnd !== undefined
        ? opts.cancelAtPeriodEnd
        : row.cancelAtPeriodEnd,
  });

  if (row.subscriberTokenId) {
    if (opts.disableToken) {
      setSubscriberTokenDisabled(row.subscriberTokenId, true);
    }
    if (opts.enableToken) {
      setSubscriberTokenDisabled(row.subscriberTokenId, false);
      if (opts.currentPeriodEnd) {
        setSubscriberTokenValidUntil(
          row.subscriberTokenId,
          opts.currentPeriodEnd,
        );
      }
    }
  }
}

/** Statuses that keep private feed access. cancel_at_period_end stays "active" until the period ends. */
function applySubscriptionObject(
  sub: Stripe.Subscription,
  opts?: { forceDisable?: boolean },
): void {
  const status = sub.status;
  const accessOk = subscriptionGrantsAccess(status) && !opts?.forceDisable;
  syncSubscriptionStatus({
    stripeSubscriptionId: sub.id,
    status,
    currentPeriodEnd: subscriptionPeriodEnd(sub),
    cancelAtPeriodEnd: isCancelScheduled(sub),
    disableToken: !accessOk,
    enableToken: accessOk,
  });
}

function paymentIntentIdFromCharge(charge: Stripe.Charge): string | null {
  if (typeof charge.payment_intent === "string") return charge.payment_intent;
  if (charge.payment_intent && typeof charge.payment_intent === "object") {
    return charge.payment_intent.id;
  }
  return null;
}

function invoiceIdFromCharge(charge: Stripe.Charge): string | null {
  const inv = (charge as { invoice?: string | { id: string } | null }).invoice;
  if (typeof inv === "string") return inv;
  if (inv && typeof inv === "object") return inv.id;
  return null;
}

function isFullyRefunded(charge: Stripe.Charge): boolean {
  if (charge.refunded) return true;
  const amount = charge.amount ?? 0;
  const refunded = charge.amount_refunded ?? 0;
  return amount > 0 && refunded >= amount;
}

function revokeLocalAccess(
  row: subs.StripeSubscriptionRow,
  status: string,
): void {
  subs.updateSubscription(row.id, {
    status,
    cancelAtPeriodEnd: false,
  });
  if (row.subscriberTokenId) {
    setSubscriberTokenDisabled(row.subscriberTokenId, true);
  }
}

async function findSubscriptionRowForCharge(
  charge: Stripe.Charge,
  secretKey: string,
): Promise<subs.StripeSubscriptionRow | undefined> {
  const pi = paymentIntentIdFromCharge(charge);
  if (pi) {
    const byPi = subs.getByPaymentIntentId(pi);
    if (byPi) return byPi;
  }

  let invoiceId = invoiceIdFromCharge(charge);
  let podcastIdFromIntent = "";
  if (pi && !isE2eStripeSecret(secretKey)) {
    try {
      const stripe = createStripeClient(secretKey);
      const intent = await stripe.paymentIntents.retrieve(pi);
      if (!invoiceId) {
        const inv = (intent as { invoice?: string | { id: string } | null })
          .invoice;
        if (typeof inv === "string") invoiceId = inv;
        else if (inv && typeof inv === "object") invoiceId = inv.id;
      }
      podcastIdFromIntent = intent.metadata?.harborfm_podcast_id?.trim() || "";
    } catch {
      /* ignore */
    }
  }

  if (invoiceId && !isE2eStripeSecret(secretKey)) {
    try {
      const stripe = createStripeClient(secretKey);
      const invoice = await stripe.invoices.retrieve(invoiceId);
      const subId = invoiceSubscriptionId(invoice);
      if (subId) {
        const bySub = subs.getByStripeSubscriptionId(subId);
        if (bySub) return bySub;
      }
    } catch {
      /* ignore */
    }
  }

  const podcastId =
    charge.metadata?.harborfm_podcast_id?.trim() || podcastIdFromIntent;
  const email =
    charge.billing_details?.email?.trim() ||
    (charge as { receipt_email?: string | null }).receipt_email?.trim() ||
    "";

  if (podcastId && email) {
    return subs.getByPodcastAndCustomerEmail(podcastId, email);
  }
  return undefined;
}

/**
 * Full refund: revoke subscriber access and notify. Partial refunds are ignored.
 */
export async function handleChargeRefunded(opts: {
  charge: Stripe.Charge;
  secretKey: string;
}): Promise<void> {
  const { charge, secretKey } = opts;
  if (!isFullyRefunded(charge)) return;

  const row = await findSubscriptionRowForCharge(charge, secretKey);
  if (!row) return;

  // Idempotent: already revoked from a prior refund / cancel event.
  if (row.status === "refunded") {
    refundRequests.markPendingApprovedForSubscription(row.id);
    return;
  }

  revokeLocalAccess(row, "refunded");
  refundRequests.markPendingApprovedForSubscription(row.id);

  if (
    row.stripeSubscriptionId &&
    !isE2eStripeSecret(secretKey)
  ) {
    try {
      const stripe = createStripeClient(secretKey);
      await stripe.subscriptions.cancel(row.stripeSubscriptionId);
    } catch {
      /* already canceled or missing */
    }
  }

  await notify.notifyForSubscriptionRow(row, "refunded", {
    amountLabel: notify.chargeAmountLabel(charge),
  });
}

export async function handleStripeEvent(opts: {
  credentialsId: string;
  event: Stripe.Event;
  secretKey: string;
}): Promise<void> {
  const { credentialsId, event, secretKey } = opts;

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.payment_status === "paid" || session.status === "complete") {
        await fulfillCheckoutSession({ credentialsId, session, secretKey });
      }
      break;
    }
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
    case "customer.subscription.paused":
    case "customer.subscription.resumed": {
      const sub = event.data.object as Stripe.Subscription;
      const prev = (event.data as { previous_attributes?: Record<string, unknown> })
        .previous_attributes;
      const wasScheduled = wasCancelScheduled(prev);
      const rowBefore = subs.getByStripeSubscriptionId(sub.id);
      // Plan delete / refund already revoked + emailed; skip duplicate cancel mail.
      const skipCancelEmail =
        rowBefore?.status === "refunded" || rowBefore?.status === "canceled";

      applySubscriptionObject(sub, {
        forceDisable:
          event.type === "customer.subscription.deleted" ||
          event.type === "customer.subscription.paused",
      });

      const status = sub.status;
      // Use dedicated pause/resume/deleted events only. Stripe often also sends
      // customer.subscription.updated for the same transition.
      if (event.type === "customer.subscription.paused") {
        await notify.notifyFromSubscriptionRow(sub.id, "paused");
      } else if (event.type === "customer.subscription.resumed") {
        await notify.notifyFromSubscriptionRow(sub.id, "resumed", {
          periodEndIso: subscriptionPeriodEnd(sub),
        });
      } else if (event.type === "customer.subscription.deleted") {
        if (!skipCancelEmail) {
          await notify.notifyFromSubscriptionRow(sub.id, "canceled");
        }
      } else if (
        event.type === "customer.subscription.updated" &&
        isCancelScheduled(sub) &&
        wasScheduled === false &&
        subscriptionGrantsAccess(status)
      ) {
        // Portal often sets cancel_at (not cancel_at_period_end). Treat either as scheduled cancel.
        await notify.notifyFromSubscriptionRow(sub.id, "cancel_scheduled", {
          periodEndIso: subscriptionCancelEnd(sub),
        });
      }
      break;
    }
    case "invoice.paid": {
      const invoice = event.data.object as Stripe.Invoice;
      const subId = invoiceSubscriptionId(invoice);
      if (!subId) break;
      let periodEnd: string | null = invoicePeriodEnd(invoice);
      let status = "active";
      let cancelAtPeriodEnd: boolean | undefined;
      if (!isE2eStripeSecret(secretKey)) {
        try {
          const stripe = createStripeClient(secretKey);
          const sub = await stripe.subscriptions.retrieve(subId);
          periodEnd = subscriptionPeriodEnd(sub) ?? periodEnd;
          status = sub.status;
          cancelAtPeriodEnd = isCancelScheduled(sub);
        } catch {
          /* ignore */
        }
      }
      // Don't re-enable access if Stripe still says paused/canceled/etc.
      const accessOk = subscriptionGrantsAccess(status);
      syncSubscriptionStatus({
        stripeSubscriptionId: subId,
        status,
        ...(periodEnd ? { currentPeriodEnd: periodEnd } : {}),
        ...(cancelAtPeriodEnd !== undefined
          ? { cancelAtPeriodEnd }
          : {}),
        enableToken: accessOk,
        disableToken: !accessOk,
      });
      // Renewal receipts only. Skip signup, resume, and plan-change invoices
      // (those already get welcome/resumed emails).
      if (notify.isRenewalInvoice(invoice) && accessOk) {
        await notify.notifyFromSubscriptionRow(subId, "payment_received", {
          amountLabel: notify.invoiceAmountLabel(invoice),
          periodEndIso: periodEnd,
          invoiceUrl: notify.invoiceHostedUrl(invoice),
        });
      }
      break;
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const subId = invoiceSubscriptionId(invoice);
      if (!subId) break;
      syncSubscriptionStatus({
        stripeSubscriptionId: subId,
        status: "past_due",
        disableToken: true,
      });
      await notify.notifyFromSubscriptionRow(subId, "payment_failed", {
        invoiceUrl: notify.invoiceHostedUrl(invoice),
      });
      break;
    }
    case "charge.refunded": {
      const charge = event.data.object as Stripe.Charge;
      await handleChargeRefunded({ charge, secretKey });
      break;
    }
    case "price.created":
    case "price.updated": {
      const price = event.data.object as Stripe.Price;
      plans.applyStripePriceToLocalPlan({
        id: price.id,
        product: price.product as string | { id: string } | null,
        unit_amount: price.unit_amount,
        currency: price.currency,
        active: price.active,
        metadata: price.metadata,
      });
      break;
    }
    default:
      break;
  }
}

/** Construct and verify a Stripe event, or accept E2E fixture payloads. */
export function constructWebhookEvent(opts: {
  payload: Buffer | string;
  signature: string | undefined;
  webhookSecret: string;
  secretKey: string;
}): Stripe.Event {
  const {
    payload: payloadRaw,
    signature,
    webhookSecret,
    secretKey,
  } = opts;

  if (isE2eStripeSecret(secretKey) || /e2e/i.test(webhookSecret)) {
    const raw =
      typeof payloadRaw === "string" ? payloadRaw : payloadRaw.toString("utf8");
    const parsed = JSON.parse(raw) as Stripe.Event;
    if (!parsed?.type || !parsed?.data?.object) {
      throw Object.assign(new Error("Invalid E2E webhook payload"), {
        statusCode: 400,
      });
    }
    return parsed;
  }

  if (!signature) {
    throw Object.assign(new Error("Missing Stripe-Signature header"), {
      statusCode: 400,
    });
  }

  const stripe = createStripeClient(secretKey);
  const payload =
    typeof payloadRaw === "string" ? payloadRaw : payloadRaw.toString("utf8");
  return stripe.webhooks.constructEvent(payload, signature, webhookSecret);
}
