import { eq, and, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { drizzleDb } from "../../db/drizzle.js";
import { stripeSubscriptions } from "../../db/schema.js";
import { STRIPE_SECRETS_AAD } from "../../config.js";
import {
  decryptSecret,
  encryptSecret,
  isEncryptedSecret,
} from "../../services/secrets.js";
import { sqlNow } from "../../db/utils.js";
import * as plans from "./plans.js";

export type StripeSubscriptionRow = typeof stripeSubscriptions.$inferSelect;

export function getByCheckoutSessionId(
  sessionId: string,
): StripeSubscriptionRow | undefined {
  if (!sessionId.trim()) return undefined;
  return drizzleDb
    .select()
    .from(stripeSubscriptions)
    .where(eq(stripeSubscriptions.stripeCheckoutSessionId, sessionId.trim()))
    .limit(1)
    .get();
}

export function getByPaymentIntentId(
  paymentIntentId: string,
): StripeSubscriptionRow | undefined {
  if (!paymentIntentId.trim()) return undefined;
  return drizzleDb
    .select()
    .from(stripeSubscriptions)
    .where(
      eq(stripeSubscriptions.stripePaymentIntentId, paymentIntentId.trim()),
    )
    .limit(1)
    .get();
}

export function getByStripeSubscriptionId(
  stripeSubscriptionId: string,
): StripeSubscriptionRow | undefined {
  if (!stripeSubscriptionId.trim()) return undefined;
  return drizzleDb
    .select()
    .from(stripeSubscriptions)
    .where(
      eq(stripeSubscriptions.stripeSubscriptionId, stripeSubscriptionId.trim()),
    )
    .limit(1)
    .get();
}

export function getByPodcastAndCustomerEmail(
  podcastId: string,
  email: string,
): StripeSubscriptionRow | undefined {
  const normalized = email.trim().toLowerCase();
  if (!podcastId.trim() || !normalized) return undefined;
  const rows = drizzleDb
    .select()
    .from(stripeSubscriptions)
    .where(eq(stripeSubscriptions.podcastId, podcastId.trim()))
    .all();
  const matches = rows.filter(
    (r) =>
      (r.customerEmail ?? "").trim().toLowerCase() === normalized &&
      r.accessTokenEnc &&
      r.status !== "canceled" &&
      r.status !== "incomplete" &&
      r.status !== "paused" &&
      r.status !== "unpaid" &&
      r.status !== "incomplete_expired",
  );
  // Prefer active / one_time over past_due
  matches.sort((a, b) => {
    const rank = (s: string) =>
      s === "active" || s === "one_time" ? 0 : s === "past_due" ? 1 : 2;
    return rank(a.status) - rank(b.status);
  });
  return matches[0];
}

export function encryptAccessToken(rawToken: string): string {
  return encryptSecret(rawToken, STRIPE_SECRETS_AAD);
}

export function decryptAccessToken(enc: string | null | undefined): string | null {
  if (!enc || !String(enc).trim()) return null;
  if (isEncryptedSecret(enc)) {
    try {
      return decryptSecret(enc, STRIPE_SECRETS_AAD);
    } catch {
      return null;
    }
  }
  return enc;
}

export function getById(id: string): StripeSubscriptionRow | undefined {
  if (!id.trim()) return undefined;
  return drizzleDb
    .select()
    .from(stripeSubscriptions)
    .where(eq(stripeSubscriptions.id, id.trim()))
    .limit(1)
    .get();
}

export function getBySubscriberTokenId(
  subscriberTokenId: string,
): StripeSubscriptionRow | undefined {
  if (!subscriberTokenId.trim()) return undefined;
  return drizzleDb
    .select()
    .from(stripeSubscriptions)
    .where(eq(stripeSubscriptions.subscriberTokenId, subscriberTokenId.trim()))
    .limit(1)
    .get();
}

/** Statuses that keep private feed access. cancel_at_period_end stays "active" until the period ends. */
export function subscriptionGrantsAccess(status: string): boolean {
  return status === "active" || status === "trialing";
}

/** Max time past valid_until we still trust an active Stripe sub (sync lag buffer). */
export const STRIPE_RENEWAL_ACCESS_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * Stripe renewals can lag the period clock by minutes/hours. While the local
 * subscription is still active/trialing, keep feed access for up to 1 day past
 * valid_until: long enough for webhook lag, short enough to surface sync bugs.
 */
export function stripeLinkedTokenWithinRenewalGrace(
  subscriberTokenId: string,
  validUntil: string,
  nowMs: number = Date.now(),
): boolean {
  const row = getBySubscriberTokenId(subscriberTokenId);
  if (!row || !subscriptionGrantsAccess(row.status)) return false;
  const untilMs = Date.parse(validUntil);
  if (!Number.isFinite(untilMs) || untilMs >= nowMs) return false;
  return nowMs - untilMs < STRIPE_RENEWAL_ACCESS_GRACE_MS;
}

export function insertSubscription(values: {
  podcastId: string;
  stripeCredentialsId: string;
  mode: string;
  planId: string | null;
  subscriberTokenId: string | null;
  stripeCustomerId: string;
  stripeSubscriptionId: string | null;
  stripeCheckoutSessionId: string | null;
  stripePaymentIntentId: string | null;
  status: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd?: boolean;
  customerEmail: string | null;
  accessTokenEnc: string | null;
  amountPaidCents?: number | null;
}): StripeSubscriptionRow {
  const id = nanoid();
  const now = new Date().toISOString();
  drizzleDb
    .insert(stripeSubscriptions)
    .values({
      id,
      podcastId: values.podcastId,
      stripeCredentialsId: values.stripeCredentialsId,
      mode: values.mode,
      planId: values.planId,
      subscriberTokenId: values.subscriberTokenId,
      stripeCustomerId: values.stripeCustomerId,
      stripeSubscriptionId: values.stripeSubscriptionId,
      stripeCheckoutSessionId: values.stripeCheckoutSessionId,
      stripePaymentIntentId: values.stripePaymentIntentId,
      status: values.status,
      currentPeriodEnd: values.currentPeriodEnd,
      cancelAtPeriodEnd: values.cancelAtPeriodEnd ?? false,
      customerEmail: values.customerEmail,
      accessTokenEnc: values.accessTokenEnc,
      amountPaidCents: values.amountPaidCents ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  const row = getById(id);
  if (!row) throw new Error("Failed to create stripe subscription row");
  return row;
}

export function updateSubscription(
  id: string,
  patch: Partial<{
    subscriberTokenId: string | null;
    stripeCustomerId: string;
    stripeSubscriptionId: string | null;
    stripePaymentIntentId: string | null;
    status: string;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    customerEmail: string | null;
    accessTokenEnc: string | null;
    accessTokenRevealedAt: string | null;
    amountPaidCents: number | null;
  }>,
): void {
  drizzleDb
    .update(stripeSubscriptions)
    .set({ ...patch, updatedAt: sqlNow() })
    .where(eq(stripeSubscriptions.id, id))
    .run();
}

/**
 * Atomically mark the access token as revealed for checkout success.
 * Returns true only on the first successful claim (race-safe).
 */
export function tryMarkAccessTokenRevealed(subscriptionId: string): boolean {
  if (!subscriptionId.trim()) return false;
  const now = new Date().toISOString();
  const result = drizzleDb
    .update(stripeSubscriptions)
    .set({ accessTokenRevealedAt: now, updatedAt: now })
    .where(
      and(
        eq(stripeSubscriptions.id, subscriptionId.trim()),
        isNull(stripeSubscriptions.accessTokenRevealedAt),
      ),
    )
    .run();
  return result.changes > 0;
}

export function listByPodcastId(podcastId: string): StripeSubscriptionRow[] {
  if (!podcastId.trim()) return [];
  return drizzleDb
    .select()
    .from(stripeSubscriptions)
    .where(eq(stripeSubscriptions.podcastId, podcastId.trim()))
    .all();
}

/**
 * Active paid listeners by plan kind.
 * Recurring: status active or trialing. One-time: status one_time.
 * Per-kind revenueCents: recurring uses each subscriber's plan price
 * (monthly = /month, yearly = /year). One-time uses amount paid when known.
 */
export function countActiveByPlanKind(podcastId: string): {
  month: number;
  year: number;
  one_time: number;
  total: number;
  monthRevenueCents: number;
  yearRevenueCents: number;
  oneTimeRevenueCents: number;
  currency: string | null;
} {
  const counts = {
    month: 0,
    year: 0,
    one_time: 0,
    total: 0,
    monthRevenueCents: 0,
    yearRevenueCents: 0,
    oneTimeRevenueCents: 0,
    currency: null as string | null,
  };

  function tryAdd(
    amountCents: number | null | undefined,
    currency: string | null | undefined,
  ): number {
    if (amountCents == null || !Number.isFinite(amountCents) || amountCents <= 0) {
      return 0;
    }
    const cur = (currency || "usd").toLowerCase();
    if (!counts.currency) counts.currency = cur;
    return cur === counts.currency ? amountCents : 0;
  }

  function oneTimePaid(
    row: StripeSubscriptionRow,
    plan: ReturnType<typeof plans.getPlanById>,
  ): number {
    if (
      row.amountPaidCents != null &&
      Number.isFinite(row.amountPaidCents) &&
      row.amountPaidCents > 0
    ) {
      return row.amountPaidCents;
    }
    return plan?.amountCents ?? 0;
  }

  for (const row of listByPodcastId(podcastId)) {
    const plan = row.planId
      ? plans.getPlanById(row.podcastId, row.planId)
      : undefined;

    if (row.status === "one_time") {
      counts.one_time += 1;
      counts.total += 1;
      counts.oneTimeRevenueCents += tryAdd(
        oneTimePaid(row, plan),
        plan?.currency,
      );
      continue;
    }

    if (row.status !== "active" && row.status !== "trialing") continue;
    const kind = plan?.kind ?? "month";
    if (kind === "one_time") {
      counts.one_time += 1;
      counts.total += 1;
      counts.oneTimeRevenueCents += tryAdd(
        oneTimePaid(row, plan),
        plan?.currency,
      );
    } else if (kind === "year") {
      counts.year += 1;
      counts.total += 1;
      counts.yearRevenueCents += tryAdd(plan?.amountCents, plan?.currency);
    } else {
      counts.month += 1;
      counts.total += 1;
      counts.monthRevenueCents += tryAdd(plan?.amountCents, plan?.currency);
    }
  }
  return counts;
}
