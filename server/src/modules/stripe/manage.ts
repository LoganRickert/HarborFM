import type { FastifyRequest } from "fastify";
import type Stripe from "stripe";
import { getBaseUrl } from "../auth/shared.js";
import { SUBSCRIBER_TOKEN_PREFIX } from "../../config.js";
import {
  lookupSubscriberTokenByValue,
  rotateSubscriberToken,
  type SubscriberTokenRow,
} from "../../services/subscriberTokens.js";
import { SUBSCRIBER_TOKENS_COOKIE } from "../public/utils.js";
import * as creds from "./credentials.js";
import * as plans from "./plans.js";
import * as subs from "./subscriptions.js";
import * as refundRequests from "./refundRequests.js";
import { createStripeClient, isE2eStripeSecret } from "./stripeClient.js";

export type ManageContext = {
  rawToken: string;
  tokenRow: SubscriberTokenRow;
  subscription: subs.StripeSubscriptionRow;
  pack: NonNullable<ReturnType<typeof creds.getById>>;
  secretKey: string;
};

function parseCookieTokenMap(cookieValue: string | undefined): Record<string, string> {
  if (!cookieValue) return {};
  try {
    const parsed = JSON.parse(cookieValue) as unknown;
    if (typeof parsed !== "object" || parsed == null || Array.isArray(parsed)) {
      return {};
    }
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string" && v.trim()) out[k] = v.trim();
    }
    return out;
  } catch {
    return {};
  }
}

function bearerToken(request: FastifyRequest): string | null {
  const auth = request.headers.authorization;
  if (typeof auth !== "string") return null;
  const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
  return m?.[1]?.trim() || null;
}

export function resolveRawSubscriberToken(
  request: FastifyRequest,
  podcastSlug: string,
  bodyToken?: string | null,
): string | null {
  const fromBody = bodyToken?.trim();
  if (fromBody) return fromBody;
  const fromBearer = bearerToken(request);
  if (fromBearer) return fromBearer;
  const map = parseCookieTokenMap(request.cookies[SUBSCRIBER_TOKENS_COOKIE]);
  const fromCookie = map[podcastSlug]?.trim();
  return fromCookie || null;
}

export function resolveManageContext(opts: {
  request: FastifyRequest;
  podcastId: string;
  podcastSlug: string;
  bodyToken?: string | null;
}): ManageContext | null {
  const rawToken = resolveRawSubscriberToken(
    opts.request,
    opts.podcastSlug,
    opts.bodyToken,
  );
  if (!rawToken) return null;
  // Allow disabled tokens so pause / payment-failed subscribers can still manage billing.
  const tokenRow = lookupSubscriberTokenByValue(rawToken);
  if (!tokenRow || tokenRow.podcastId !== opts.podcastId) return null;
  const subscription = subs.getBySubscriberTokenId(tokenRow.id);
  if (!subscription || subscription.podcastId !== opts.podcastId) return null;
  const pack = creds.getById(subscription.stripeCredentialsId);
  if (!pack) return null;
  const secretKey = creds.getActiveSecretKey(pack);
  if (!secretKey) return null;
  return { rawToken, tokenRow, subscription, pack, secretKey };
}

function isRecurring(row: subs.StripeSubscriptionRow): boolean {
  return Boolean(row.stripeSubscriptionId) && row.status !== "one_time";
}

/**
 * Stripe rejects updates that send both cancel_at_period_end and cancel_at.
 * Clear whichever form of scheduled cancel is set (portal often uses cancel_at).
 */
async function clearScheduledCancellation(
  stripe: ReturnType<typeof createStripeClient>,
  subscriptionId: string,
): Promise<Stripe.Subscription> {
  const current = await stripe.subscriptions.retrieve(subscriptionId);
  if (typeof current.cancel_at === "number") {
    return stripe.subscriptions.update(subscriptionId, {
      // Empty string unsets cancel_at (cannot also send cancel_at_period_end).
      cancel_at: "",
    });
  }
  return stripe.subscriptions.update(subscriptionId, {
    cancel_at_period_end: false,
  });
}

function periodEndFromSubscription(
  sub: Stripe.Subscription,
  fallback: string | null,
): string | null {
  const fromItem = sub.items?.data?.[0]?.current_period_end;
  const legacy = (sub as { current_period_end?: number }).current_period_end;
  const periodSec = fromItem ?? legacy;
  return typeof periodSec === "number"
    ? new Date(periodSec * 1000).toISOString()
    : fallback;
}

function isCancelScheduled(sub: Stripe.Subscription): boolean {
  return Boolean(sub.cancel_at_period_end) || typeof sub.cancel_at === "number";
}

export type SubscriptionStatusDto = {
  hasSubscription: true;
  status: string;
  plan: {
    id: string;
    kind: string;
    amountCents: number;
    currency: string;
    autoRenewDefault: boolean;
  } | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  stripeMode: "test" | "live";
  customerEmail: string | null;
  canManageBilling: boolean;
  canCancelAtPeriodEnd: boolean;
  canRenew: boolean;
  canRegenerateAccessToken: boolean;
  canRequestRefund: boolean;
  refundRequest: {
    status: "pending" | "approved" | "rejected";
    amountCents: number;
    currency: string;
    createdAt: string;
  } | null;
  isOneTime: boolean;
};

export function getSubscriptionStatus(
  ctx: ManageContext,
): SubscriptionStatusDto {
  const { subscription: row, tokenRow } = ctx;
  const plan = row.planId
    ? plans.getPlanById(row.podcastId, row.planId)
    : undefined;
  const recurring = isRecurring(row);
  const canManageBilling = Boolean(row.stripeCustomerId?.trim()) && recurring;
  const canCancelAtPeriodEnd =
    recurring &&
    (row.status === "active" || row.status === "trialing" || row.status === "past_due");
  const canRenew =
    recurring &&
    (row.cancelAtPeriodEnd ||
      row.status === "past_due" ||
      (plan != null && !plan.autoRenewDefault && row.status === "active"));
  const canRegenerateAccessToken = !tokenRow.disabled;
  const latestRefund = refundRequests.getLatestForSubscription(row.id);
  const canRequestRefund =
    refundRequests.subscriptionAllowsRefundRequest(row) && !latestRefund;

  return {
    hasSubscription: true,
    status: row.status,
    plan: plan
      ? {
          id: plan.id,
          kind: plan.kind,
          amountCents: plan.amountCents,
          currency: plan.currency,
          autoRenewDefault: Boolean(plan.autoRenewDefault),
        }
      : null,
    currentPeriodEnd: row.currentPeriodEnd,
    cancelAtPeriodEnd: Boolean(row.cancelAtPeriodEnd),
    stripeMode: (row.mode === "live" ? "live" : "test") as "test" | "live",
    customerEmail: row.customerEmail,
    canManageBilling,
    canCancelAtPeriodEnd,
    canRenew,
    canRegenerateAccessToken,
    canRequestRefund,
    refundRequest: latestRefund
      ? {
          status: latestRefund.status as "pending" | "approved" | "rejected",
          amountCents: latestRefund.amountCents,
          currency: latestRefund.currency,
          createdAt: latestRefund.createdAt,
        }
      : null,
    isOneTime: row.status === "one_time" || !row.stripeSubscriptionId,
  };
}

export async function createBillingPortalSession(opts: {
  ctx: ManageContext;
  returnUrl?: string | null;
  podcastSlug: string;
}): Promise<{ url: string }> {
  const { ctx, podcastSlug } = opts;
  if (!ctx.subscription.stripeCustomerId?.trim()) {
    throw Object.assign(new Error("No Stripe customer on this subscription"), {
      statusCode: 400,
    });
  }
  if (!isRecurring(ctx.subscription)) {
    throw Object.assign(new Error("Billing portal is only for recurring subscriptions"), {
      statusCode: 400,
    });
  }

  const base = getBaseUrl();
  const returnUrl =
    opts.returnUrl?.trim() ||
    `${base}/feed/${encodeURIComponent(podcastSlug)}?manage=true`;

  if (isE2eStripeSecret(ctx.secretKey)) {
    return {
      url: `https://billing.stripe.com/e2e/session/${encodeURIComponent(ctx.subscription.id)}?return_url=${encodeURIComponent(returnUrl)}`,
    };
  }

  const stripe = createStripeClient(ctx.secretKey);
  const session = await stripe.billingPortal.sessions.create({
    customer: ctx.subscription.stripeCustomerId,
    return_url: returnUrl,
  });
  if (!session.url) {
    throw Object.assign(new Error("Stripe did not return a portal URL"), {
      statusCode: 502,
    });
  }
  return { url: session.url };
}

export async function setCancelAtPeriodEnd(opts: {
  ctx: ManageContext;
  cancel: boolean;
}): Promise<{
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  status: string;
}> {
  const { ctx, cancel } = opts;
  const subId = ctx.subscription.stripeSubscriptionId;
  if (!subId || ctx.subscription.status === "one_time") {
    throw Object.assign(
      new Error("Auto-renew can only be changed on a recurring subscription"),
      { statusCode: 400 },
    );
  }

  if (isE2eStripeSecret(ctx.secretKey)) {
    subs.updateSubscription(ctx.subscription.id, {
      cancelAtPeriodEnd: cancel,
    });
    return {
      cancelAtPeriodEnd: cancel,
      currentPeriodEnd: ctx.subscription.currentPeriodEnd,
      status: ctx.subscription.status,
    };
  }

  const stripe = createStripeClient(ctx.secretKey);
  const updated = cancel
    ? await stripe.subscriptions.update(subId, {
        cancel_at_period_end: true,
      })
    : await clearScheduledCancellation(stripe, subId);
  const periodEnd = periodEndFromSubscription(
    updated,
    ctx.subscription.currentPeriodEnd,
  );
  const scheduled = isCancelScheduled(updated);

  subs.updateSubscription(ctx.subscription.id, {
    cancelAtPeriodEnd: scheduled,
    currentPeriodEnd: periodEnd,
    status: updated.status,
  });

  return {
    cancelAtPeriodEnd: scheduled,
    currentPeriodEnd: periodEnd,
    status: updated.status,
  };
}

/** Shared 1-minute cooldown window for subscriber manage / recover actions. */
export const STRIPE_ACTION_COOLDOWN_MS = 60_000;

/**
 * In-memory once-per-window gate. Marks the key immediately so parallel
 * requests cannot bypass the limit.
 */
export function assertAndMarkCooldown(
  map: Map<string, number>,
  key: string,
  windowMs: number,
  actionLabel: string,
): void {
  const now = Date.now();
  const prev = map.get(key);
  if (prev !== undefined && now - prev < windowMs) {
    const retryAfterSec = Math.max(
      1,
      Math.ceil((windowMs - (now - prev)) / 1000),
    );
    throw Object.assign(
      new Error(
        `You can only ${actionLabel} once per minute. Try again in ${retryAfterSec} second${retryAfterSec === 1 ? "" : "s"}.`,
      ),
      { statusCode: 429, retryAfterSec },
    );
  }
  map.set(key, now);
}

const lastRenewAt = new Map<string, number>();
const lastTokenRegenerateAt = new Map<string, number>();
/** Keyed by `${podcastId}:${normalizedEmail}`; used by recover-token route. */
export const lastRecoverTokenAt = new Map<string, number>();

/**
 * Resume auto-renew (undo cancel_at_period_end), or return a hosted invoice /
 * portal URL when payment is needed.
 */
export async function renewSubscription(opts: {
  ctx: ManageContext;
  podcastSlug: string;
}): Promise<{ ok: true; cancelAtPeriodEnd?: boolean; url?: string; status?: string }> {
  const { ctx, podcastSlug } = opts;
  if (!isRecurring(ctx.subscription)) {
    throw Object.assign(new Error("Renew is only for recurring subscriptions"), {
      statusCode: 400,
    });
  }

  assertAndMarkCooldown(
    lastRenewAt,
    ctx.subscription.id,
    STRIPE_ACTION_COOLDOWN_MS,
    "renew your subscription",
  );

  const subId = ctx.subscription.stripeSubscriptionId!;

  if (isE2eStripeSecret(ctx.secretKey)) {
    if (ctx.subscription.cancelAtPeriodEnd) {
      subs.updateSubscription(ctx.subscription.id, {
        cancelAtPeriodEnd: false,
        status: "active",
      });
      return { ok: true, cancelAtPeriodEnd: false, status: "active" };
    }
    if (ctx.subscription.status === "past_due") {
      return {
        ok: true,
        url: `https://invoice.stripe.com/e2e/${encodeURIComponent(ctx.subscription.id)}`,
      };
    }
    // Manual renew for non-auto plans: stub hosted invoice
    return {
      ok: true,
      url: `https://invoice.stripe.com/e2e/renew/${encodeURIComponent(ctx.subscription.id)}`,
    };
  }

  const stripe = createStripeClient(ctx.secretKey);

  if (ctx.subscription.cancelAtPeriodEnd) {
    const updated = await clearScheduledCancellation(stripe, subId);
    const stillScheduled = isCancelScheduled(updated);
    subs.updateSubscription(ctx.subscription.id, {
      cancelAtPeriodEnd: stillScheduled,
      status: updated.status,
    });
    return { ok: true, cancelAtPeriodEnd: stillScheduled, status: updated.status };
  }

  if (ctx.subscription.status === "past_due") {
    const open = await stripe.invoices.list({
      subscription: subId,
      status: "open",
      limit: 1,
    });
    const hosted = open.data[0]?.hosted_invoice_url;
    if (hosted) return { ok: true, url: hosted };

    const portal = await createBillingPortalSession({
      ctx,
      podcastSlug,
    });
    return { ok: true, url: portal.url };
  }

  // Manual renew: create an invoice and return hosted URL when possible
  const invoice = await stripe.invoices.create({
    customer: ctx.subscription.stripeCustomerId,
    subscription: subId,
    collection_method: "send_invoice",
    days_until_due: 7,
    auto_advance: true,
  });
  let finalized = invoice;
  if (invoice.status === "draft") {
    finalized = await stripe.invoices.finalizeInvoice(invoice.id);
  }
  if (finalized.hosted_invoice_url) {
    return { ok: true, url: finalized.hosted_invoice_url };
  }
  const portal = await createBillingPortalSession({ ctx, podcastSlug });
  return { ok: true, url: portal.url };
}

export function regenerateAccessToken(ctx: ManageContext): string {
  if (!ctx.subscription.subscriberTokenId) {
    throw Object.assign(new Error("No subscriber token linked"), {
      statusCode: 400,
    });
  }
  if (ctx.tokenRow.disabled) {
    throw Object.assign(
      new Error(
        "Access is disabled for this subscription, so the token cannot be regenerated.",
      ),
      { statusCode: 403 },
    );
  }

  assertAndMarkCooldown(
    lastTokenRegenerateAt,
    ctx.subscription.id,
    STRIPE_ACTION_COOLDOWN_MS,
    "regenerate your access token",
  );

  const rawToken = rotateSubscriberToken(
    ctx.subscription.subscriberTokenId,
    SUBSCRIBER_TOKEN_PREFIX,
  );
  if (!rawToken) {
    throw Object.assign(new Error("Could not regenerate token"), {
      statusCode: 500,
    });
  }
  subs.updateSubscription(ctx.subscription.id, {
    accessTokenEnc: subs.encryptAccessToken(rawToken),
  });
  return rawToken;
}
