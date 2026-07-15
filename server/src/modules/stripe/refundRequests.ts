import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { drizzleDb } from "../../db/drizzle.js";
import { stripeRefundRequests } from "../../db/schema.js";
import { sqlNow } from "../../db/utils.js";
import { setSubscriberTokenDisabled } from "../../services/subscriberTokens.js";
import * as creds from "./credentials.js";
import * as plans from "./plans.js";
import * as subs from "./subscriptions.js";
import * as notify from "./notify.js";
import { createStripeClient, isE2eStripeSecret } from "./stripeClient.js";
import type { ManageContext } from "./manage.js";

export type RefundRequestRow = typeof stripeRefundRequests.$inferSelect;
export type RefundRequestStatus = "pending" | "approved" | "rejected";

export type RefundRequestDto = {
  id: string;
  status: RefundRequestStatus;
  amountCents: number;
  currency: string;
  customerEmail: string | null;
  planKind: string | null;
  createdAt: string;
  resolvedAt: string | null;
};

function toDto(
  row: RefundRequestRow,
  extras?: { customerEmail?: string | null; planKind?: string | null },
): RefundRequestDto {
  return {
    id: row.id,
    status: row.status as RefundRequestStatus,
    amountCents: row.amountCents,
    currency: row.currency,
    customerEmail: extras?.customerEmail ?? null,
    planKind: extras?.planKind ?? null,
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt,
  };
}

export function getById(id: string): RefundRequestRow | undefined {
  if (!id.trim()) return undefined;
  return drizzleDb
    .select()
    .from(stripeRefundRequests)
    .where(eq(stripeRefundRequests.id, id.trim()))
    .limit(1)
    .get();
}

export function getPendingForSubscription(
  subscriptionId: string,
): RefundRequestRow | undefined {
  if (!subscriptionId.trim()) return undefined;
  return drizzleDb
    .select()
    .from(stripeRefundRequests)
    .where(
      and(
        eq(stripeRefundRequests.subscriptionId, subscriptionId.trim()),
        eq(stripeRefundRequests.status, "pending"),
      ),
    )
    .limit(1)
    .get();
}

/** Latest request for a subscription (any status). */
export function getLatestForSubscription(
  subscriptionId: string,
): RefundRequestRow | undefined {
  if (!subscriptionId.trim()) return undefined;
  return drizzleDb
    .select()
    .from(stripeRefundRequests)
    .where(eq(stripeRefundRequests.subscriptionId, subscriptionId.trim()))
    .orderBy(desc(stripeRefundRequests.createdAt))
    .limit(1)
    .get();
}

export function listForPodcast(podcastId: string): RefundRequestDto[] {
  const rows = drizzleDb
    .select()
    .from(stripeRefundRequests)
    .where(eq(stripeRefundRequests.podcastId, podcastId.trim()))
    .orderBy(desc(stripeRefundRequests.createdAt))
    .all();

  return rows.map((row) => {
    const sub = subs.getById(row.subscriptionId);
    const plan = sub?.planId
      ? plans.getPlanById(sub.podcastId, sub.planId)
      : undefined;
    return toDto(row, {
      customerEmail: sub?.customerEmail ?? null,
      planKind: plan?.kind ?? null,
    });
  });
}

export function subscriptionAllowsRefundRequest(
  row: subs.StripeSubscriptionRow,
): boolean {
  if (row.status === "refunded" || row.status === "canceled") return false;
  if (row.status === "incomplete" || row.status === "incomplete_expired") {
    return false;
  }
  return (
    row.status === "active" ||
    row.status === "trialing" ||
    row.status === "one_time" ||
    row.status === "past_due"
  );
}

export async function createRefundRequest(
  ctx: ManageContext,
): Promise<RefundRequestDto> {
  const { subscription: row } = ctx;
  if (!subscriptionAllowsRefundRequest(row)) {
    throw Object.assign(
      new Error("This subscription is not eligible for a refund request"),
      { statusCode: 400 },
    );
  }
  if (getPendingForSubscription(row.id)) {
    throw Object.assign(
      new Error("A refund request is already pending for this subscription"),
      { statusCode: 409 },
    );
  }
  const prior = getLatestForSubscription(row.id);
  if (prior) {
    throw Object.assign(
      new Error(
        prior.status === "rejected"
          ? "A refund request for this subscription was already denied"
          : prior.status === "approved"
            ? "A refund for this subscription was already approved"
            : "A refund request already exists for this subscription",
      ),
      { statusCode: 409 },
    );
  }

  const plan = row.planId
    ? plans.getPlanById(row.podcastId, row.planId)
    : undefined;
  const paidCents =
    row.amountPaidCents != null &&
    Number.isFinite(row.amountPaidCents) &&
    row.amountPaidCents > 0
      ? row.amountPaidCents
      : null;
  const amountCents =
    paidCents ??
    (plan && Number.isFinite(plan.amountCents) && plan.amountCents > 0
      ? plan.amountCents
      : null);
  const currency = (
    plan?.currency ||
    "usd"
  ).toLowerCase();
  if (amountCents == null) {
    throw Object.assign(
      new Error("Could not determine the refund amount for this plan"),
      { statusCode: 400 },
    );
  }

  const id = nanoid();
  const now = new Date().toISOString();
  drizzleDb
    .insert(stripeRefundRequests)
    .values({
      id,
      podcastId: row.podcastId,
      subscriptionId: row.id,
      status: "pending",
      amountCents,
      currency,
      stripeRefundId: null,
      resolvedByUserId: null,
      createdAt: now,
      updatedAt: now,
      resolvedAt: null,
    })
    .run();

  const created = getById(id);
  if (!created) throw new Error("Failed to create refund request");
  const dto = toDto(created, {
    customerEmail: row.customerEmail,
    planKind: plan?.kind ?? null,
  });

  await notify.notifyOwnerRefundRequested({
    podcastId: row.podcastId,
    customerEmail: row.customerEmail,
    amountLabel: notify.formatMoneyPublic(amountCents, currency),
    planKind: plan?.kind ?? null,
  });

  return dto;
}

async function paymentIntentFromInvoice(
  stripe: ReturnType<typeof createStripeClient>,
  invoiceId: string,
): Promise<string | null> {
  try {
    const payments = await stripe.invoicePayments.list({
      invoice: invoiceId,
      limit: 10,
    });
    for (const p of payments.data) {
      if (p.status && p.status !== "paid") continue;
      const pi = p.payment?.payment_intent;
      if (typeof pi === "string" && pi.trim()) return pi.trim();
      if (pi && typeof pi === "object" && "id" in pi) {
        const id = (pi as { id: string }).id;
        if (id?.trim()) return id.trim();
      }
    }
  } catch {
    /* ignore */
  }
  try {
    const inv = (await stripe.invoices.retrieve(invoiceId)) as {
      payment_intent?: string | { id: string } | null;
    };
    if (typeof inv.payment_intent === "string") return inv.payment_intent;
    if (inv.payment_intent && typeof inv.payment_intent === "object") {
      return inv.payment_intent.id;
    }
  } catch {
    /* ignore */
  }
  return null;
}

async function resolvePaymentIntentId(
  row: subs.StripeSubscriptionRow,
  secretKey: string,
): Promise<string | null> {
  if (row.stripePaymentIntentId?.trim()) {
    return row.stripePaymentIntentId.trim();
  }
  if (isE2eStripeSecret(secretKey)) return null;

  const stripe = createStripeClient(secretKey);

  // Recurring: latest paid invoice → invoice_payments → payment_intent
  if (row.stripeSubscriptionId?.trim()) {
    try {
      const invoices = await stripe.invoices.list({
        subscription: row.stripeSubscriptionId.trim(),
        status: "paid",
        limit: 3,
      });
      for (const inv of invoices.data) {
        const pi = await paymentIntentFromInvoice(stripe, inv.id);
        if (pi) {
          subs.updateSubscription(row.id, { stripePaymentIntentId: pi });
          return pi;
        }
      }
    } catch {
      /* ignore */
    }
  }

  // Checkout session may point at an invoice (subscription) or payment_intent (one-time)
  if (row.stripeCheckoutSessionId?.trim()) {
    try {
      const session = await stripe.checkout.sessions.retrieve(
        row.stripeCheckoutSessionId.trim(),
      );
      if (typeof session.payment_intent === "string" && session.payment_intent) {
        subs.updateSubscription(row.id, {
          stripePaymentIntentId: session.payment_intent,
        });
        return session.payment_intent;
      }
      if (
        session.payment_intent &&
        typeof session.payment_intent === "object" &&
        "id" in session.payment_intent
      ) {
        const pi = session.payment_intent.id;
        subs.updateSubscription(row.id, { stripePaymentIntentId: pi });
        return pi;
      }
      const invoiceId =
        typeof session.invoice === "string"
          ? session.invoice
          : session.invoice && typeof session.invoice === "object"
            ? session.invoice.id
            : null;
      if (invoiceId) {
        const pi = await paymentIntentFromInvoice(stripe, invoiceId);
        if (pi) {
          subs.updateSubscription(row.id, { stripePaymentIntentId: pi });
          return pi;
        }
      }
    } catch {
      /* ignore */
    }
  }

  // Last resort: recent charges for this customer matching podcast metadata / amount
  if (row.stripeCustomerId?.trim()) {
    try {
      const charges = await stripe.charges.list({
        customer: row.stripeCustomerId.trim(),
        limit: 10,
      });
      const plan = row.planId
        ? plans.getPlanById(row.podcastId, row.planId)
        : undefined;
      const match = charges.data.find((c) => {
        if (!c.paid || c.refunded) return false;
        if (typeof c.payment_intent !== "string" || !c.payment_intent) {
          return false;
        }
        if (plan && c.amount === plan.amountCents) return true;
        const meta = c.metadata || {};
        return meta.harborfm_podcast_id === row.podcastId;
      });
      if (match && typeof match.payment_intent === "string") {
        subs.updateSubscription(row.id, {
          stripePaymentIntentId: match.payment_intent,
        });
        return match.payment_intent;
      }
    } catch {
      /* ignore */
    }
  }

  return null;
}

function revokeAccess(row: subs.StripeSubscriptionRow): void {
  subs.updateSubscription(row.id, {
    status: "refunded",
    cancelAtPeriodEnd: false,
  });
  if (row.subscriberTokenId) {
    setSubscriberTokenDisabled(row.subscriberTokenId, true);
  }
}

export async function approveRefundRequest(opts: {
  podcastId: string;
  requestId: string;
  resolvedByUserId: string;
}): Promise<RefundRequestDto> {
  const req = getById(opts.requestId);
  if (!req || req.podcastId !== opts.podcastId) {
    throw Object.assign(new Error("Refund request not found"), {
      statusCode: 404,
    });
  }
  if (req.status !== "pending") {
    throw Object.assign(new Error("This refund request is already resolved"), {
      statusCode: 409,
    });
  }

  const row = subs.getById(req.subscriptionId);
  if (!row || row.podcastId !== opts.podcastId) {
    throw Object.assign(new Error("Subscription not found"), {
      statusCode: 404,
    });
  }

  const pack = creds.getById(row.stripeCredentialsId);
  if (!pack) {
    throw Object.assign(new Error("Stripe credentials not found"), {
      statusCode: 400,
    });
  }
  const secretKey = creds.getActiveSecretKey(pack);
  if (!secretKey) {
    throw Object.assign(new Error("Stripe secret key is not configured"), {
      statusCode: 400,
    });
  }

  let stripeRefundId: string | null = null;

  if (isE2eStripeSecret(secretKey)) {
    stripeRefundId = `re_e2e_${nanoid()}`;
  } else {
    const paymentIntentId = await resolvePaymentIntentId(row, secretKey);
    if (!paymentIntentId) {
      throw Object.assign(
        new Error(
          "Could not find a Stripe payment to refund for this subscription",
        ),
        { statusCode: 400 },
      );
    }
    try {
      const stripe = createStripeClient(secretKey);
      const refund = await stripe.refunds.create({
        payment_intent: paymentIntentId,
        amount: req.amountCents,
        reason: "requested_by_customer",
      });
      stripeRefundId = refund.id;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Stripe refund failed";
      throw Object.assign(new Error(message), { statusCode: 502 });
    }

    if (row.stripeSubscriptionId?.trim()) {
      try {
        const stripe = createStripeClient(secretKey);
        await stripe.subscriptions.cancel(row.stripeSubscriptionId.trim());
      } catch {
        /* already canceled */
      }
    }
  }

  const now = new Date().toISOString();
  drizzleDb
    .update(stripeRefundRequests)
    .set({
      status: "approved",
      stripeRefundId,
      resolvedByUserId: opts.resolvedByUserId,
      resolvedAt: now,
      updatedAt: sqlNow(),
    })
    .where(eq(stripeRefundRequests.id, req.id))
    .run();

  revokeAccess(row);

  await notify.notifyForSubscriptionRow(row, "refunded", {
    amountLabel: notify.formatMoneyPublic(req.amountCents, req.currency),
  });

  const updated = getById(req.id)!;
  const plan = row.planId
    ? plans.getPlanById(row.podcastId, row.planId)
    : undefined;
  return toDto(updated, {
    customerEmail: row.customerEmail,
    planKind: plan?.kind ?? null,
  });
}

export async function rejectRefundRequest(opts: {
  podcastId: string;
  requestId: string;
  resolvedByUserId: string;
}): Promise<RefundRequestDto> {
  const req = getById(opts.requestId);
  if (!req || req.podcastId !== opts.podcastId) {
    throw Object.assign(new Error("Refund request not found"), {
      statusCode: 404,
    });
  }
  if (req.status !== "pending") {
    throw Object.assign(new Error("This refund request is already resolved"), {
      statusCode: 409,
    });
  }

  const row = subs.getById(req.subscriptionId);
  const now = new Date().toISOString();
  drizzleDb
    .update(stripeRefundRequests)
    .set({
      status: "rejected",
      resolvedByUserId: opts.resolvedByUserId,
      resolvedAt: now,
      updatedAt: sqlNow(),
    })
    .where(eq(stripeRefundRequests.id, req.id))
    .run();

  if (row) {
    await notify.notifyForSubscriptionRow(row, "refund_denied", {
      amountLabel: notify.formatMoneyPublic(req.amountCents, req.currency),
    });
  }

  const updated = getById(req.id)!;
  const plan = row?.planId
    ? plans.getPlanById(row.podcastId, row.planId)
    : undefined;
  return toDto(updated, {
    customerEmail: row?.customerEmail ?? null,
    planKind: plan?.kind ?? null,
  });
}

/** When Stripe Dashboard refunds a charge, mark any pending request approved. */
export function markPendingApprovedForSubscription(
  subscriptionId: string,
  stripeRefundId?: string | null,
): void {
  const pending = getPendingForSubscription(subscriptionId);
  if (!pending) return;
  const now = new Date().toISOString();
  drizzleDb
    .update(stripeRefundRequests)
    .set({
      status: "approved",
      stripeRefundId: stripeRefundId ?? pending.stripeRefundId,
      resolvedAt: now,
      updatedAt: sqlNow(),
    })
    .where(eq(stripeRefundRequests.id, pending.id))
    .run();
}
