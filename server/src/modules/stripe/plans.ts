import { basename } from "path";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type {
  StripeMode,
  StripePlanCreate,
  StripePlanKind,
  StripePlanUpdate,
} from "@harborfm/shared";
import { API_PREFIX } from "../../config.js";
import { drizzleDb } from "../../db/drizzle.js";
import { podcasts, stripePlans } from "../../db/schema.js";
import { setSubscriberTokenDisabled } from "../../services/subscriberTokens.js";
import { getBaseUrl } from "../auth/shared.js";
import * as creds from "./credentials.js";
import * as notify from "./notify.js";
import * as subs from "./subscriptions.js";
import {
  archiveProductAndPrice,
  createProductAndPrice,
  createStripeClient,
  isE2eStripeSecret,
  productDashboardUrl,
  replacePrice,
  setProductActive,
} from "./stripeClient.js";

export type StripePlanRow = typeof stripePlans.$inferSelect;

export function toPlanApi(row: StripePlanRow) {
  return {
    id: row.id,
    podcastId: row.podcastId,
    mode: (row.mode === "live" ? "live" : "test") as StripeMode,
    kind: row.kind as StripePlanKind,
    amountCents: row.amountCents,
    currency: row.currency,
    active: Boolean(row.active),
    stripeProductId: row.stripeProductId,
    stripePriceId: row.stripePriceId,
    autoRenewDefault: Boolean(row.autoRenewDefault),
    syncError: row.syncError ?? null,
    productUrl: row.stripeProductId
      ? productDashboardUrl(
          row.stripeProductId,
          row.mode === "live" ? "live" : "test",
        )
      : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function listPlansForPodcast(
  podcastId: string,
  mode?: StripeMode,
): StripePlanRow[] {
  const rows = drizzleDb
    .select()
    .from(stripePlans)
    .where(eq(stripePlans.podcastId, podcastId))
    .all();
  const filtered =
    mode === undefined
      ? rows
      : rows.filter((r) => (r.mode === "live" ? "live" : "test") === mode);
  return filtered.sort((a, b) => {
    const order = { month: 0, year: 1, one_time: 2 } as Record<string, number>;
    return (order[a.kind] ?? 9) - (order[b.kind] ?? 9);
  });
}

export function getPlanById(
  podcastId: string,
  planId: string,
): StripePlanRow | undefined {
  return drizzleDb
    .select()
    .from(stripePlans)
    .where(
      and(eq(stripePlans.id, planId), eq(stripePlans.podcastId, podcastId)),
    )
    .limit(1)
    .get();
}

export function getPlanByStripePriceId(
  stripePriceId: string,
): StripePlanRow | undefined {
  if (!stripePriceId.trim()) return undefined;
  return drizzleDb
    .select()
    .from(stripePlans)
    .where(eq(stripePlans.stripePriceId, stripePriceId.trim()))
    .limit(1)
    .get();
}

export function getPlanByStripeProductId(
  stripeProductId: string,
): StripePlanRow | undefined {
  if (!stripeProductId.trim()) return undefined;
  return drizzleDb
    .select()
    .from(stripePlans)
    .where(eq(stripePlans.stripeProductId, stripeProductId.trim()))
    .limit(1)
    .get();
}

/**
 * Apply a Stripe Price object onto the matching local plan (Dashboard edits).
 * Matches by metadata.harborfm_plan_id, then stripe_price_id, then product id.
 */
export function applyStripePriceToLocalPlan(price: {
  id: string;
  product: string | { id: string } | null;
  unit_amount: number | null;
  currency: string;
  active: boolean;
  metadata?: Record<string, string> | null;
}): StripePlanRow | null {
  const metaPlanId = price.metadata?.harborfm_plan_id?.trim();
  const productId =
    typeof price.product === "string"
      ? price.product
      : price.product && typeof price.product === "object"
        ? price.product.id
        : "";

  let row: StripePlanRow | undefined;
  if (metaPlanId) {
    row = drizzleDb
      .select()
      .from(stripePlans)
      .where(eq(stripePlans.id, metaPlanId))
      .limit(1)
      .get();
  }
  if (!row) row = getPlanByStripePriceId(price.id);
  if (!row && productId) row = getPlanByStripeProductId(productId);
  if (!row) return null;

  const set: Partial<StripePlanRow> = {
    updatedAt: new Date().toISOString(),
    syncError: null,
    stripePriceId: price.id,
    active: Boolean(price.active),
  };
  if (price.unit_amount != null && Number.isFinite(price.unit_amount)) {
    set.amountCents = price.unit_amount;
  }
  if (price.currency?.trim()) {
    set.currency = price.currency.trim().toLowerCase();
  }
  if (productId) set.stripeProductId = productId;

  drizzleDb
    .update(stripePlans)
    .set(set)
    .where(eq(stripePlans.id, row.id))
    .run();
  return getPlanById(row.podcastId, row.id) ?? null;
}

function getPodcastTitle(podcastId: string): string {
  const row = drizzleDb
    .select({ title: podcasts.title })
    .from(podcasts)
    .where(eq(podcasts.id, podcastId))
    .limit(1)
    .get();
  return row?.title?.trim() || "Podcast";
}

/** Public cover URL Stripe can fetch for product images (skip localhost). */
export function getPodcastCoverImageUrl(podcastId: string): string | null {
  const row = drizzleDb
    .select({
      artworkUrl: podcasts.artworkUrl,
      artworkPath: podcasts.artworkPath,
    })
    .from(podcasts)
    .where(eq(podcasts.id, podcastId))
    .limit(1)
    .get();
  if (!row) return null;

  let url = "";
  const external = row.artworkUrl?.trim();
  if (external && /^https?:\/\//i.test(external)) {
    url = external;
  } else if (row.artworkPath?.trim()) {
    const filename = basename(row.artworkPath);
    if (filename) {
      const base = getBaseUrl();
      url = `${base}/${API_PREFIX}/public/artwork/${encodeURIComponent(podcastId)}/${encodeURIComponent(filename)}`;
    }
  }
  if (!url) return null;

  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host.endsWith(".local")
    ) {
      return null;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

function requireActivePack(podcastId: string): {
  pack: NonNullable<ReturnType<typeof creds.getById>>;
  secretKey: string;
  mode: StripeMode;
} {
  const podcast = creds.getPodcastStripeFields(podcastId);
  if (!podcast?.stripeCredentialsId) {
    throw Object.assign(new Error("Link a Stripe account to this show first"), {
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
    throw Object.assign(
      new Error("Active-mode restricted key is missing for this Stripe account"),
      { statusCode: 400 },
    );
  }
  const mode = (pack.mode === "live" ? "live" : "test") as StripeMode;
  return { pack, secretKey, mode };
}

export async function createPlan(
  podcastId: string,
  body: StripePlanCreate,
): Promise<StripePlanRow> {
  const { secretKey, mode } = requireActivePack(podcastId);
  const existingActive = listPlansForPodcast(podcastId, mode).find(
    (p) => p.kind === body.kind && Boolean(p.active),
  );
  if (existingActive) {
    throw Object.assign(
      new Error(
        `An active ${body.kind} plan already exists for ${mode} mode. Deactivate it first to add a new one.`,
      ),
      { statusCode: 400 },
    );
  }

  const id = nanoid();
  const now = new Date().toISOString();
  const autoRenew =
    body.kind === "one_time" ? false : body.autoRenewDefault !== false;

  let stripeProductId = "";
  let stripePriceId = "";
  let syncError: string | null = null;
  try {
    const synced = await createProductAndPrice({
      secretKey,
      podcastId,
      planId: id,
      podcastTitle: getPodcastTitle(podcastId),
      kind: body.kind,
      amountCents: body.amountCents,
      currency: body.currency,
      imageUrl: getPodcastCoverImageUrl(podcastId),
    });
    stripeProductId = synced.stripeProductId;
    stripePriceId = synced.stripePriceId;
  } catch (err) {
    syncError =
      err instanceof Error ? err.message : "Failed to create Stripe product";
    throw Object.assign(new Error(syncError), { statusCode: 502 });
  }

  drizzleDb
    .insert(stripePlans)
    .values({
      id,
      podcastId,
      mode,
      kind: body.kind,
      amountCents: body.amountCents,
      currency: body.currency,
      active: body.active !== false,
      stripeProductId,
      stripePriceId,
      autoRenewDefault: autoRenew,
      syncError,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  if (body.active === false) {
    try {
      await setProductActive({
        secretKey,
        stripeProductId,
        active: false,
      });
    } catch {
      /* local row still created */
    }
  }

  return getPlanById(podcastId, id)!;
}

export async function updatePlan(
  podcastId: string,
  planId: string,
  body: StripePlanUpdate,
): Promise<StripePlanRow> {
  const row = getPlanById(podcastId, planId);
  if (!row) {
    throw Object.assign(new Error("Plan not found"), { statusCode: 404 });
  }
  const { secretKey, mode } = requireActivePack(podcastId);
  if ((row.mode === "live" ? "live" : "test") !== mode) {
    throw Object.assign(
      new Error(
        `This plan is for ${row.mode} mode. Select a ${row.mode} Stripe account on this show to edit it.`,
      ),
      { statusCode: 400 },
    );
  }

  const set: Partial<StripePlanRow> = {
    updatedAt: new Date().toISOString(),
    syncError: null,
  };

  const amountCents = body.amountCents ?? row.amountCents;
  const currency = body.currency ?? row.currency;
  const priceChanged =
    amountCents !== row.amountCents || currency !== row.currency;

  if (priceChanged) {
    try {
      const replaced = await replacePrice({
        secretKey,
        podcastId,
        planId: row.id,
        stripeProductId: row.stripeProductId,
        oldStripePriceId: row.stripePriceId,
        kind: row.kind as StripePlanKind,
        amountCents,
        currency,
      });
      set.amountCents = amountCents;
      set.currency = currency;
      set.stripePriceId = replaced.stripePriceId;
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to update Stripe price";
      drizzleDb
        .update(stripePlans)
        .set({ syncError: msg, updatedAt: new Date().toISOString() })
        .where(eq(stripePlans.id, planId))
        .run();
      throw Object.assign(new Error(msg), { statusCode: 502 });
    }
  }

  if (body.active !== undefined) {
    if (body.active === true && !row.active) {
      const otherActive = listPlansForPodcast(podcastId, mode).find(
        (p) => p.id !== row.id && p.kind === row.kind && Boolean(p.active),
      );
      if (otherActive) {
        throw Object.assign(
          new Error(
            `An active ${row.kind} plan already exists. Deactivate it before reactivating this one.`,
          ),
          { statusCode: 400 },
        );
      }
    }
    set.active = body.active;
    try {
      await setProductActive({
        secretKey,
        stripeProductId: row.stripeProductId,
        active: body.active,
      });
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to update Stripe product";
      drizzleDb
        .update(stripePlans)
        .set({ syncError: msg, updatedAt: new Date().toISOString() })
        .where(eq(stripePlans.id, planId))
        .run();
      throw Object.assign(new Error(msg), { statusCode: 502 });
    }
  }

  if (body.autoRenewDefault !== undefined && row.kind !== "one_time") {
    set.autoRenewDefault = body.autoRenewDefault;
  }

  drizzleDb
    .update(stripePlans)
    .set(set)
    .where(eq(stripePlans.id, planId))
    .run();
  return getPlanById(podcastId, planId)!;
}

export async function deletePlan(
  podcastId: string,
  planId: string,
): Promise<void> {
  const row = getPlanById(podcastId, planId);
  if (!row) {
    throw Object.assign(new Error("Plan not found"), { statusCode: 404 });
  }
  const planMode = (row.mode === "live" ? "live" : "test") as StripeMode;
  const podcast = creds.getPodcastStripeFields(podcastId);
  let secretKey: string | null = null;
  if (podcast?.stripeCredentialsId) {
    const pack = creds.getById(podcast.stripeCredentialsId);
    if (pack) secretKey = creds.getSecretKeyForMode(pack, planMode);
  }
  if (secretKey) {
    try {
      await archiveProductAndPrice({
        secretKey,
        stripeProductId: row.stripeProductId,
        stripePriceId: row.stripePriceId,
      });
    } catch {
      /* still delete local */
    }
  }

  // Recurring plans: cancel active Stripe subscriptions in the same mode and
  // revoke local access. One-time purchases keep access (already paid).
  if (row.kind === "month" || row.kind === "year") {
    await cancelSubscriptionsForDeletedPlan({
      podcastId,
      planId: row.id,
      mode: planMode,
      secretKey,
    });
  }

  drizzleDb.delete(stripePlans).where(eq(stripePlans.id, planId)).run();
}

const CANCEL_ON_PLAN_DELETE_STATUSES = new Set([
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "paused",
]);

async function cancelSubscriptionsForDeletedPlan(opts: {
  podcastId: string;
  planId: string;
  mode: StripeMode;
  secretKey: string | null;
}): Promise<void> {
  const rows = subs
    .listByPodcastId(opts.podcastId)
    .filter(
      (r) =>
        r.planId === opts.planId &&
        (r.mode === "live" ? "live" : "test") === opts.mode &&
        CANCEL_ON_PLAN_DELETE_STATUSES.has(r.status),
    );

  for (const subRow of rows) {
    // Mark canceled locally first so the Stripe webhook does not send a
    // duplicate "subscription ended" email after subscriptions.cancel().
    subs.updateSubscription(subRow.id, {
      status: "canceled",
      cancelAtPeriodEnd: false,
    });
    if (subRow.subscriberTokenId) {
      setSubscriberTokenDisabled(subRow.subscriberTokenId, true);
    }
    await notify.notifyForSubscriptionRow(subRow, "canceled");

    const stripeSubId = subRow.stripeSubscriptionId?.trim();
    if (
      stripeSubId &&
      opts.secretKey &&
      !isE2eStripeSecret(opts.secretKey)
    ) {
      try {
        const stripe = createStripeClient(opts.secretKey);
        await stripe.subscriptions.cancel(stripeSubId);
      } catch {
        /* already canceled or missing */
      }
    }
  }
}
