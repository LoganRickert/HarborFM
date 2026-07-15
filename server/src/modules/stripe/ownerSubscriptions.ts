import { and, asc, desc, eq, inArray, like, sql } from "drizzle-orm";
import { drizzleDb } from "../../db/drizzle.js";
import { stripeSubscriptions } from "../../db/schema.js";
import { setSubscriberTokenDisabled } from "../../services/subscriberTokens.js";
import * as creds from "./credentials.js";
import * as plans from "./plans.js";
import {
  createStripeClient,
  customerDashboardUrl,
  isE2eStripeSecret,
  subscriptionDashboardUrl,
} from "./stripeClient.js";
import * as subs from "./subscriptions.js";

const ACTIVE_STATUSES = ["active", "trialing", "one_time"] as const;

export type OwnerSubscriptionDto = {
  id: string;
  status: string;
  mode: "test" | "live";
  planKind: "month" | "year" | "one_time" | null;
  planAmountCents: number | null;
  planCurrency: string | null;
  customerEmail: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  isOneTime: boolean;
  canCancelAutoRenew: boolean;
  stripeUrl: string | null;
  createdAt: string;
};

function toMode(mode: string): "test" | "live" {
  return mode === "live" ? "live" : "test";
}

export function toOwnerSubscriptionDto(
  row: subs.StripeSubscriptionRow,
): OwnerSubscriptionDto {
  const mode = toMode(row.mode);
  const plan = row.planId
    ? plans.getPlanById(row.podcastId, row.planId)
    : undefined;
  const isOneTime =
    row.status === "one_time" || !row.stripeSubscriptionId;
  const stripeUrl = row.stripeSubscriptionId
    ? subscriptionDashboardUrl(row.stripeSubscriptionId, mode)
    : row.stripeCustomerId
      ? customerDashboardUrl(row.stripeCustomerId, mode)
      : null;

  return {
    id: row.id,
    status: row.status,
    mode,
    planKind: (plan?.kind as OwnerSubscriptionDto["planKind"]) ?? null,
    planAmountCents: plan?.amountCents ?? null,
    planCurrency: plan?.currency ?? null,
    customerEmail: row.customerEmail,
    currentPeriodEnd: row.currentPeriodEnd,
    cancelAtPeriodEnd: Boolean(row.cancelAtPeriodEnd),
    isOneTime,
    canCancelAutoRenew:
      !isOneTime &&
      !row.cancelAtPeriodEnd &&
      (row.status === "active" || row.status === "trialing"),
    stripeUrl,
    createdAt: row.createdAt,
  };
}

export function listActiveForPodcast(opts: {
  podcastId: string;
  limit?: number;
  offset?: number;
  q?: string;
  sort?: "newest" | "oldest";
}): { subscriptions: OwnerSubscriptionDto[]; total: number } {
  const podcastId = opts.podcastId.trim();
  const limit = Math.min(Math.max(opts.limit ?? 10, 1), 100);
  const offset = Math.max(opts.offset ?? 0, 0);
  const sort = opts.sort === "oldest" ? "oldest" : "newest";

  const conditions = [
    eq(stripeSubscriptions.podcastId, podcastId),
    inArray(stripeSubscriptions.status, [...ACTIVE_STATUSES]),
  ];
  if (opts.q?.trim()) {
    conditions.push(
      like(stripeSubscriptions.customerEmail, `%${opts.q.trim()}%`),
    );
  }
  const whereClause = and(...conditions);

  const countResult = drizzleDb
    .select({ count: sql<number>`COUNT(*)`.as("count") })
    .from(stripeSubscriptions)
    .where(whereClause)
    .get();
  const total = countResult?.count ?? 0;

  const orderBy =
    sort === "oldest"
      ? asc(stripeSubscriptions.createdAt)
      : desc(stripeSubscriptions.createdAt);

  const rows = drizzleDb
    .select()
    .from(stripeSubscriptions)
    .where(whereClause)
    .orderBy(orderBy)
    .limit(limit)
    .offset(offset)
    .all();

  return {
    subscriptions: rows.map(toOwnerSubscriptionDto),
    total,
  };
}

function requireRowForPodcast(
  podcastId: string,
  subscriptionId: string,
): subs.StripeSubscriptionRow {
  const row = subs.getById(subscriptionId);
  if (!row || row.podcastId !== podcastId) {
    throw Object.assign(new Error("Subscription not found"), {
      statusCode: 404,
    });
  }
  return row;
}

/**
 * Turn off auto-renew in Stripe (cancel at period end). Local row is synced.
 */
export async function cancelAutoRenew(opts: {
  podcastId: string;
  subscriptionId: string;
}): Promise<OwnerSubscriptionDto> {
  const row = requireRowForPodcast(opts.podcastId, opts.subscriptionId);
  const subId = row.stripeSubscriptionId;
  if (!subId || row.status === "one_time") {
    throw Object.assign(
      new Error("Auto-renew can only be changed on a recurring subscription"),
      { statusCode: 400 },
    );
  }
  if (row.cancelAtPeriodEnd) {
    return toOwnerSubscriptionDto(row);
  }

  const pack = creds.getById(row.stripeCredentialsId);
  if (!pack) {
    throw Object.assign(new Error("Stripe account not found for this subscription"), {
      statusCode: 400,
    });
  }
  const secretKey = creds.getActiveSecretKey(pack);
  if (!secretKey) {
    throw Object.assign(new Error("Stripe secret key is not configured"), {
      statusCode: 400,
    });
  }

  if (isE2eStripeSecret(secretKey)) {
    subs.updateSubscription(row.id, { cancelAtPeriodEnd: true });
    return toOwnerSubscriptionDto(subs.getById(row.id)!);
  }

  const stripe = createStripeClient(secretKey);
  const updated = await stripe.subscriptions.update(subId, {
    cancel_at_period_end: true,
  });
  const fromItem = updated.items?.data?.[0]?.current_period_end;
  const legacy = (updated as { current_period_end?: number }).current_period_end;
  const periodSec = fromItem ?? legacy;
  const periodEnd =
    typeof periodSec === "number"
      ? new Date(periodSec * 1000).toISOString()
      : row.currentPeriodEnd;
  const scheduled =
    Boolean(updated.cancel_at_period_end) || typeof updated.cancel_at === "number";

  subs.updateSubscription(row.id, {
    cancelAtPeriodEnd: scheduled,
    currentPeriodEnd: periodEnd,
    status: updated.status,
  });

  return toOwnerSubscriptionDto(subs.getById(row.id)!);
}

/**
 * Remove the local HarborFM subscription row (and disable its feed token).
 * Does not cancel or refund in Stripe; for cleanup when local state is wrong.
 */
export function deleteLocalSubscription(opts: {
  podcastId: string;
  subscriptionId: string;
}): void {
  const row = requireRowForPodcast(opts.podcastId, opts.subscriptionId);
  if (row.subscriberTokenId) {
    setSubscriberTokenDisabled(row.subscriberTokenId, true);
  }
  drizzleDb
    .delete(stripeSubscriptions)
    .where(eq(stripeSubscriptions.id, row.id))
    .run();
}
