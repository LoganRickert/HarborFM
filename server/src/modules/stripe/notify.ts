import { eq, and, sql } from "drizzle-orm";
import type Stripe from "stripe";
import { drizzleDb } from "../../db/drizzle.js";
import { podcasts, users } from "../../db/schema.js";
import { API_PREFIX } from "../../config.js";
import { getBaseUrl } from "../auth/shared.js";
import {
  readSettings,
  isEmailProviderConfigured,
} from "../settings/index.js";
import {
  sendMail,
  buildStripeWelcomeEmail,
  buildStripeSubscriberNoticeEmail,
} from "../../services/email.js";
import { createSubscriberClaimUrl } from "../public/subscriberClaim.js";
import * as subs from "./subscriptions.js";

type PodcastInfo = { id: string; slug: string; title: string; ownerUserId: string };

function getPodcast(podcastId: string): PodcastInfo | null {
  if (!podcastId.trim()) return null;
  const row = drizzleDb
    .select({
      id: podcasts.id,
      slug: podcasts.slug,
      title: podcasts.title,
      ownerUserId: podcasts.ownerUserId,
    })
    .from(podcasts)
    .where(eq(podcasts.id, podcastId.trim()))
    .limit(1)
    .get();
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    title: row.title?.trim() || row.slug,
    ownerUserId: row.ownerUserId,
  };
}

function getOwnerEmail(podcastId: string): string | null {
  const row = drizzleDb
    .select({ email: users.email })
    .from(podcasts)
    .innerJoin(users, eq(podcasts.ownerUserId, users.id))
    .where(
      and(
        eq(podcasts.id, podcastId.trim()),
        sql`COALESCE(${users.disabled}, 0) = 0`,
      ),
    )
    .limit(1)
    .get();
  return row?.email?.trim() || null;
}

function privateRssUrl(baseUrl: string, slug: string, rawToken: string): string {
  return `${baseUrl}/${API_PREFIX}/public/podcasts/${encodeURIComponent(slug)}/private/${encodeURIComponent(rawToken)}/rss`;
}

function manageUrl(baseUrl: string, slug: string): string {
  return `${baseUrl}/feed/${encodeURIComponent(slug)}?manage=true`;
}

function claimManageUrl(baseUrl: string, slug: string, rawToken: string): string {
  return createSubscriberClaimUrl({
    baseUrl,
    podcastSlug: slug,
    rawToken,
  });
}

function formatMoney(amountCents: number | null | undefined, currency: string | null | undefined): string | null {
  if (amountCents == null || !Number.isFinite(amountCents)) return null;
  const cur = (currency || "usd").toUpperCase();
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: cur,
    }).format(amountCents / 100);
  } catch {
    return `${(amountCents / 100).toFixed(2)} ${cur}`;
  }
}

export function formatMoneyPublic(
  amountCents: number | null | undefined,
  currency: string | null | undefined,
): string | null {
  return formatMoney(amountCents, currency);
}

function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
      new Date(iso),
    );
  } catch {
    return iso;
  }
}

async function sendIfConfigured(
  to: string | null | undefined,
  content: { subject: string; text: string; html: string },
): Promise<void> {
  const email = to?.trim();
  if (!email) return;
  const settings = readSettings();
  if (!isEmailProviderConfigured(settings)) return;
  try {
    await sendMail({
      to: email,
      subject: content.subject,
      text: content.text,
      html: content.html,
    });
  } catch (err) {
    console.warn("[stripe] Failed to send subscriber email:", err);
  }
}

export async function notifyWelcome(opts: {
  podcastId: string;
  customerEmail: string | null;
  rawToken: string;
}): Promise<void> {
  const podcast = getPodcast(opts.podcastId);
  if (!podcast || !opts.customerEmail?.trim()) return;
  const baseUrl = getBaseUrl();
  const content = buildStripeWelcomeEmail({
    baseUrl,
    podcastTitle: podcast.title,
    rawToken: opts.rawToken,
    privateRssUrl: privateRssUrl(baseUrl, podcast.slug, opts.rawToken),
    manageUrl: claimManageUrl(baseUrl, podcast.slug, opts.rawToken),
  });
  await sendIfConfigured(opts.customerEmail, content);
}

export async function notifyFromSubscriptionRow(
  stripeSubscriptionId: string,
  kind:
    | "paused"
    | "canceled"
    | "resumed"
    | "cancel_scheduled"
    | "payment_failed"
    | "payment_received"
    | "refunded"
    | "refund_denied",
  extras?: {
    amountLabel?: string | null;
    periodEndIso?: string | null;
    invoiceUrl?: string | null;
  },
): Promise<void> {
  const row = subs.getByStripeSubscriptionId(stripeSubscriptionId);
  if (!row) return;
  await notifyForSubscriptionRow(row, kind, extras);
}

export async function notifyForSubscriptionRow(
  row: subs.StripeSubscriptionRow,
  kind:
    | "paused"
    | "canceled"
    | "resumed"
    | "cancel_scheduled"
    | "payment_failed"
    | "payment_received"
    | "refunded"
    | "refund_denied",
  extras?: {
    amountLabel?: string | null;
    periodEndIso?: string | null;
    invoiceUrl?: string | null;
  },
): Promise<void> {
  if (!row.customerEmail?.trim()) return;
  const podcast = getPodcast(row.podcastId);
  if (!podcast) return;
  const baseUrl = getBaseUrl();
  const periodEnd = formatDate(extras?.periodEndIso ?? row.currentPeriodEnd);

  let eyebrow: string;
  let subject: string;
  let paragraphs: string[];

  switch (kind) {
    case "paused":
      eyebrow = "Subscription paused";
      subject = `Your ${podcast.title} subscription is paused`;
      paragraphs = [
        `Your subscription to ${podcast.title} is paused, so access to subscriber-only content is temporarily unavailable.`,
        "When you are ready, resume your subscription in Stripe billing to restore access.",
      ];
      break;
    case "canceled":
      eyebrow = "Subscription canceled";
      subject = `Your ${podcast.title} subscription has ended`;
      paragraphs = [
        `Your subscription to ${podcast.title} has been canceled, and subscriber access is no longer available.`,
        "You can subscribe again anytime from the show page if you want access back.",
      ];
      break;
    case "resumed":
      eyebrow = "Subscription resumed";
      subject = `Your ${podcast.title} subscription is active again`;
      paragraphs = [
        `Good news: your subscription to ${podcast.title} is active again, and subscriber access has been restored.`,
      ];
      break;
    case "cancel_scheduled":
      eyebrow = "Auto-renew turned off";
      subject = `Your ${podcast.title} subscription will end soon`;
      paragraphs = [
        `Auto-renew is off for your ${podcast.title} subscription.`,
        periodEnd
          ? `You will keep access until ${periodEnd}. After that, subscriber content will lock again unless you renew.`
          : "You will keep access until the end of the current billing period.",
      ];
      break;
    case "payment_failed":
      eyebrow = "Payment failed";
      subject = `Payment failed for ${podcast.title}`;
      paragraphs = [
        `We could not collect payment for your ${podcast.title} subscription, so subscriber access has been paused until payment succeeds.`,
        "Update your payment method in Stripe billing to restore access.",
      ];
      break;
    case "payment_received":
      eyebrow = "Payment received";
      subject = extras?.amountLabel
        ? `Payment received for ${podcast.title} (${extras.amountLabel})`
        : `Payment received for ${podcast.title}`;
      paragraphs = [
        extras?.amountLabel
          ? `Thanks! We received your payment of ${extras.amountLabel} for ${podcast.title}.`
          : `Thanks! We received your payment for ${podcast.title}.`,
        periodEnd
          ? `Your access continues through ${periodEnd}.`
          : "Your subscriber access remains active.",
      ];
      break;
    case "refunded":
      eyebrow = "Payment refunded";
      subject = extras?.amountLabel
        ? `Refund issued for ${podcast.title} (${extras.amountLabel})`
        : `Refund issued for ${podcast.title}`;
      paragraphs = [
        extras?.amountLabel
          ? `A refund of ${extras.amountLabel} for ${podcast.title} has been issued.`
          : `A refund for ${podcast.title} has been issued.`,
        "Subscriber access has been revoked. You can subscribe again from the show page if you want access back.",
      ];
      break;
    case "refund_denied":
      eyebrow = "Refund request denied";
      subject = `Refund request denied for ${podcast.title}`;
      paragraphs = [
        `Your refund request for ${podcast.title} was not approved.`,
        extras?.amountLabel
          ? `The requested amount was ${extras.amountLabel}. Your subscription and access are unchanged.`
          : "Your subscription and access are unchanged.",
      ];
      break;
    default:
      return;
  }

  const rawToken =
    kind === "refunded" || kind === "canceled"
      ? null
      : subs.decryptAccessToken(row.accessTokenEnc);
  const content = buildStripeSubscriberNoticeEmail({
    baseUrl,
    podcastTitle: podcast.title,
    eyebrow,
    subject,
    paragraphs,
    manageUrl: rawToken
      ? claimManageUrl(baseUrl, podcast.slug, rawToken)
      : manageUrl(baseUrl, podcast.slug),
    invoiceUrl: extras?.invoiceUrl ?? null,
  });
  await sendIfConfigured(row.customerEmail, content);
}

export function invoiceAmountLabel(invoice: Stripe.Invoice): string | null {
  return formatMoney(invoice.amount_paid ?? invoice.total, invoice.currency);
}

export function chargeAmountLabel(charge: Stripe.Charge): string | null {
  return formatMoney(
    charge.amount_refunded || charge.amount,
    charge.currency,
  );
}

export function invoiceHostedUrl(invoice: Stripe.Invoice): string | null {
  return invoice.hosted_invoice_url?.trim() || null;
}

/** True for the first invoice of a new subscription (welcome email covers signup). */
export function isSubscriptionCreateInvoice(invoice: Stripe.Invoice): boolean {
  const reason = (invoice as { billing_reason?: string | null }).billing_reason;
  return reason === "subscription_create";
}

/** Regular recurring renewal (monthly/yearly cycle). Not signup, resume, or plan changes. */
export function isRenewalInvoice(invoice: Stripe.Invoice): boolean {
  const reason = (invoice as { billing_reason?: string | null }).billing_reason;
  return reason === "subscription_cycle";
}

function planKindLabel(kind: string | null | undefined): string {
  if (kind === "month") return "monthly";
  if (kind === "year") return "yearly";
  if (kind === "one_time") return "one-time";
  return "subscription";
}

/** Email the show owner when a listener submits a refund request. */
export async function notifyOwnerRefundRequested(opts: {
  podcastId: string;
  customerEmail: string | null;
  amountLabel: string | null;
  planKind: string | null;
}): Promise<void> {
  const podcast = getPodcast(opts.podcastId);
  if (!podcast) return;
  const ownerEmail = getOwnerEmail(opts.podcastId);
  if (!ownerEmail) return;

  const baseUrl = getBaseUrl();
  const reviewUrl = `${baseUrl}/podcasts/${encodeURIComponent(podcast.id)}`;
  const listener = opts.customerEmail?.trim() || "A listener";
  const amount = opts.amountLabel?.trim();
  const plan = planKindLabel(opts.planKind);
  const amountBit = amount ? ` for ${amount}` : "";

  const content = buildStripeSubscriberNoticeEmail({
    baseUrl,
    podcastTitle: podcast.title,
    eyebrow: "Refund request",
    subject: `Refund request for ${podcast.title}`,
    paragraphs: [
      `${listener} requested a refund${amountBit} on their ${plan} plan for ${podcast.title}.`,
      "Review the request in Stripe Payments on your show page to approve or deny it.",
    ],
    manageUrl: reviewUrl,
    ctaLabel: "Review refund requests",
  });
  await sendIfConfigured(ownerEmail, content);
}
