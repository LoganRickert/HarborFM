import { and, desc, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import type {
  StripeCouponCreate,
  StripeCouponDiscountType,
  StripeCouponDuration,
  StripeCouponUpdate,
  StripeMode,
} from "@harborfm/shared";
import { drizzleDb } from "../../db/drizzle.js";
import {
  stripeCouponRedemptions,
  stripeCoupons,
} from "../../db/schema.js";
import { sqlNow } from "../../db/utils.js";
import * as creds from "./credentials.js";
import {
  couponDashboardUrl,
  createCouponAndPromotionCode,
  deactivateCouponAndPromotionCode,
  updatePromotionCode,
} from "./stripeClient.js";

export type StripeCouponRow = typeof stripeCoupons.$inferSelect;
export type StripeCouponRedemptionRow =
  typeof stripeCouponRedemptions.$inferSelect;

export type CouponRedemptionDto = {
  id: string;
  subscriptionId: string;
  customerEmail: string | null;
  createdAt: string;
  amountOffCents: number | null;
  percentOff: number | null;
};

export type CouponApi = {
  id: string;
  podcastId: string;
  mode: StripeMode;
  code: string;
  name: string | null;
  discountType: StripeCouponDiscountType;
  percentOff: number | null;
  amountOffCents: number | null;
  currency: string;
  duration: StripeCouponDuration;
  durationInMonths: number | null;
  startsAt: string | null;
  endsAt: string | null;
  maxRedemptions: number | null;
  active: boolean;
  stripeCouponId: string;
  stripePromotionCodeId: string;
  syncError: string | null;
  couponUrl: string | null;
  redemptionCount: number;
  redemptions: CouponRedemptionDto[];
  createdAt: string;
  updatedAt: string;
};

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

export function countRedemptions(couponId: string): number {
  const row = drizzleDb
    .select({
      n: sql<number>`count(*)`.mapWith(Number),
    })
    .from(stripeCouponRedemptions)
    .where(eq(stripeCouponRedemptions.couponId, couponId))
    .get();
  return row?.n ?? 0;
}

export function listRedemptionsForCoupon(
  couponId: string,
  limit = 50,
): CouponRedemptionDto[] {
  return drizzleDb
    .select()
    .from(stripeCouponRedemptions)
    .where(eq(stripeCouponRedemptions.couponId, couponId))
    .orderBy(desc(stripeCouponRedemptions.createdAt))
    .limit(limit)
    .all()
    .map((r) => ({
      id: r.id,
      subscriptionId: r.subscriptionId,
      customerEmail: r.customerEmail,
      createdAt: r.createdAt,
      amountOffCents: r.amountOffCents,
      percentOff: r.percentOff,
    }));
}

/** Whether a coupon should enable Checkout promotion codes / be redeemable now. */
export function isCouponCurrentlyActive(
  row: StripeCouponRow,
  nowMs: number = Date.now(),
): boolean {
  if (!row.active) return false;
  if (!row.stripeCouponId || !row.stripePromotionCodeId) return false;
  if (row.syncError) return false;
  if (row.startsAt) {
    const start = Date.parse(row.startsAt);
    if (Number.isFinite(start) && nowMs < start) return false;
  }
  if (row.endsAt) {
    const end = Date.parse(row.endsAt);
    if (Number.isFinite(end) && nowMs > end) return false;
  }
  if (row.maxRedemptions != null && row.maxRedemptions > 0) {
    if (countRedemptions(row.id) >= row.maxRedemptions) return false;
  }
  return true;
}

/** Promo code `active` flag sent to Stripe (start window + admin toggle). */
function promoShouldBeActiveOnStripe(
  row: Pick<
    StripeCouponRow,
    "active" | "startsAt" | "endsAt"
  >,
  nowMs: number = Date.now(),
): boolean {
  if (!row.active) return false;
  if (row.startsAt) {
    const start = Date.parse(row.startsAt);
    if (Number.isFinite(start) && nowMs < start) return false;
  }
  if (row.endsAt) {
    const end = Date.parse(row.endsAt);
    if (Number.isFinite(end) && nowMs > end) return false;
  }
  return true;
}

export function toCouponApi(row: StripeCouponRow): CouponApi {
  const mode = (row.mode === "live" ? "live" : "test") as StripeMode;
  return {
    id: row.id,
    podcastId: row.podcastId,
    mode,
    code: row.code,
    name: row.name,
    discountType: row.discountType as StripeCouponDiscountType,
    percentOff: row.percentOff,
    amountOffCents: row.amountOffCents,
    currency: row.currency,
    duration: row.duration as StripeCouponDuration,
    durationInMonths: row.durationInMonths,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    maxRedemptions: row.maxRedemptions,
    active: Boolean(row.active),
    stripeCouponId: row.stripeCouponId,
    stripePromotionCodeId: row.stripePromotionCodeId,
    syncError: row.syncError ?? null,
    couponUrl: row.stripeCouponId
      ? couponDashboardUrl(row.stripeCouponId, mode)
      : null,
    redemptionCount: countRedemptions(row.id),
    redemptions: listRedemptionsForCoupon(row.id),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function listCouponsForPodcast(
  podcastId: string,
  mode?: StripeMode,
): StripeCouponRow[] {
  const rows = drizzleDb
    .select()
    .from(stripeCoupons)
    .where(eq(stripeCoupons.podcastId, podcastId))
    .all();
  const filtered =
    mode === undefined
      ? rows
      : rows.filter((r) => (r.mode === "live" ? "live" : "test") === mode);
  return filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getCouponById(
  podcastId: string,
  couponId: string,
): StripeCouponRow | undefined {
  return drizzleDb
    .select()
    .from(stripeCoupons)
    .where(
      and(
        eq(stripeCoupons.id, couponId),
        eq(stripeCoupons.podcastId, podcastId),
      ),
    )
    .limit(1)
    .get();
}

export function getCouponByStripePromotionCodeId(
  podcastId: string,
  promoId: string,
): StripeCouponRow | undefined {
  if (!promoId.trim()) return undefined;
  return drizzleDb
    .select()
    .from(stripeCoupons)
    .where(
      and(
        eq(stripeCoupons.podcastId, podcastId),
        eq(stripeCoupons.stripePromotionCodeId, promoId.trim()),
      ),
    )
    .limit(1)
    .get();
}

export function getCouponByStripeCouponId(
  podcastId: string,
  stripeCouponId: string,
): StripeCouponRow | undefined {
  if (!stripeCouponId.trim()) return undefined;
  return drizzleDb
    .select()
    .from(stripeCoupons)
    .where(
      and(
        eq(stripeCoupons.podcastId, podcastId),
        eq(stripeCoupons.stripeCouponId, stripeCouponId.trim()),
      ),
    )
    .limit(1)
    .get();
}

export function hasActiveCouponsForPodcast(
  podcastId: string,
  mode: StripeMode,
): boolean {
  return listCouponsForPodcast(podcastId, mode).some((r) =>
    isCouponCurrentlyActive(r),
  );
}

export async function createCoupon(
  podcastId: string,
  body: StripeCouponCreate,
): Promise<StripeCouponRow> {
  const { secretKey, mode } = requireActivePack(podcastId);
  const code = body.code.trim().toUpperCase();
  const dup = listCouponsForPodcast(podcastId, mode).find(
    (c) => c.code.toUpperCase() === code,
  );
  if (dup) {
    throw Object.assign(
      new Error(`A coupon with code ${code} already exists for ${mode} mode`),
      { statusCode: 400 },
    );
  }

  const id = nanoid();
  const now = new Date().toISOString();
  const durationInMonths =
    body.duration === "repeating" ? (body.durationInMonths ?? null) : null;
  const percentOff =
    body.discountType === "percent" ? (body.percentOff ?? null) : null;
  const amountOffCents =
    body.discountType === "amount" ? (body.amountOffCents ?? null) : null;

  const draft: StripeCouponRow = {
    id,
    podcastId,
    mode,
    code,
    name: body.name?.trim() || null,
    discountType: body.discountType,
    percentOff,
    amountOffCents,
    currency: (body.currency || "usd").toLowerCase(),
    duration: body.duration,
    durationInMonths,
    startsAt: body.startsAt ?? null,
    endsAt: body.endsAt ?? null,
    maxRedemptions: body.maxRedemptions ?? null,
    active: body.active !== false,
    stripeCouponId: "",
    stripePromotionCodeId: "",
    syncError: null,
    createdAt: now,
    updatedAt: now,
  };

  let stripeCouponId = "";
  let stripePromotionCodeId = "";
  let syncError: string | null = null;
  try {
    const synced = await createCouponAndPromotionCode({
      secretKey,
      podcastId,
      couponId: id,
      mode,
      code,
      name: draft.name,
      discountType: body.discountType,
      percentOff,
      amountOffCents,
      currency: draft.currency,
      duration: body.duration,
      durationInMonths,
      endsAt: draft.endsAt,
      maxRedemptions: draft.maxRedemptions,
      promoActive: promoShouldBeActiveOnStripe(draft),
    });
    stripeCouponId = synced.stripeCouponId;
    stripePromotionCodeId = synced.stripePromotionCodeId;
  } catch (err) {
    syncError = err instanceof Error ? err.message : "Stripe sync failed";
  }

  drizzleDb
    .insert(stripeCoupons)
    .values({
      ...draft,
      stripeCouponId,
      stripePromotionCodeId,
      syncError,
    })
    .run();

  const row = getCouponById(podcastId, id);
  if (!row) throw new Error("Failed to create coupon");
  if (syncError) {
    throw Object.assign(new Error(syncError), { statusCode: 502 });
  }
  return row;
}

export async function updateCoupon(
  podcastId: string,
  couponId: string,
  body: StripeCouponUpdate,
): Promise<StripeCouponRow> {
  const { secretKey } = requireActivePack(podcastId);
  const existing = getCouponById(podcastId, couponId);
  if (!existing) {
    throw Object.assign(new Error("Coupon not found"), { statusCode: 404 });
  }

  const next: StripeCouponRow = {
    ...existing,
    name:
      body.name !== undefined
        ? body.name?.trim() || null
        : existing.name,
    startsAt:
      body.startsAt !== undefined ? body.startsAt : existing.startsAt,
    endsAt: body.endsAt !== undefined ? body.endsAt : existing.endsAt,
    maxRedemptions:
      body.maxRedemptions !== undefined
        ? body.maxRedemptions
        : existing.maxRedemptions,
    active: body.active !== undefined ? body.active : existing.active,
    updatedAt: new Date().toISOString(),
  };

  let syncError: string | null = null;
  try {
    await updatePromotionCode({
      secretKey,
      stripePromotionCodeId: existing.stripePromotionCodeId,
      active: promoShouldBeActiveOnStripe(next),
    });
  } catch (err) {
    syncError = err instanceof Error ? err.message : "Stripe sync failed";
  }

  drizzleDb
    .update(stripeCoupons)
    .set({
      name: next.name,
      startsAt: next.startsAt,
      endsAt: next.endsAt,
      maxRedemptions: next.maxRedemptions,
      active: next.active,
      syncError,
      updatedAt: sqlNow(),
    })
    .where(
      and(
        eq(stripeCoupons.id, couponId),
        eq(stripeCoupons.podcastId, podcastId),
      ),
    )
    .run();

  const row = getCouponById(podcastId, couponId);
  if (!row) throw new Error("Failed to update coupon");
  if (syncError) {
    throw Object.assign(new Error(syncError), { statusCode: 502 });
  }
  return row;
}

export async function deleteCoupon(
  podcastId: string,
  couponId: string,
): Promise<void> {
  const { secretKey } = requireActivePack(podcastId);
  const existing = getCouponById(podcastId, couponId);
  if (!existing) {
    throw Object.assign(new Error("Coupon not found"), { statusCode: 404 });
  }
  try {
    await deactivateCouponAndPromotionCode({
      secretKey,
      stripeCouponId: existing.stripeCouponId,
      stripePromotionCodeId: existing.stripePromotionCodeId,
    });
  } catch {
    /* best-effort */
  }
  drizzleDb
    .delete(stripeCoupons)
    .where(
      and(
        eq(stripeCoupons.id, couponId),
        eq(stripeCoupons.podcastId, podcastId),
      ),
    )
    .run();
}

export function getRedemptionBySubscriptionId(
  subscriptionId: string,
): StripeCouponRedemptionRow | undefined {
  if (!subscriptionId.trim()) return undefined;
  return drizzleDb
    .select()
    .from(stripeCouponRedemptions)
    .where(eq(stripeCouponRedemptions.subscriptionId, subscriptionId.trim()))
    .limit(1)
    .get();
}

export function recordRedemption(opts: {
  couponId: string;
  subscriptionId: string;
  podcastId: string;
  customerEmail: string | null;
  stripeCheckoutSessionId: string | null;
  stripePromotionCodeId: string | null;
  stripeCouponId: string | null;
  amountOffCents: number | null;
  percentOff: number | null;
}): void {
  if (getRedemptionBySubscriptionId(opts.subscriptionId)) return;
  if (opts.stripeCheckoutSessionId) {
    const bySession = drizzleDb
      .select()
      .from(stripeCouponRedemptions)
      .where(
        eq(
          stripeCouponRedemptions.stripeCheckoutSessionId,
          opts.stripeCheckoutSessionId,
        ),
      )
      .limit(1)
      .get();
    if (bySession) return;
  }

  drizzleDb
    .insert(stripeCouponRedemptions)
    .values({
      id: nanoid(),
      couponId: opts.couponId,
      subscriptionId: opts.subscriptionId,
      podcastId: opts.podcastId,
      customerEmail: opts.customerEmail,
      stripeCheckoutSessionId: opts.stripeCheckoutSessionId,
      stripePromotionCodeId: opts.stripePromotionCodeId,
      stripeCouponId: opts.stripeCouponId,
      amountOffCents: opts.amountOffCents,
      percentOff: opts.percentOff,
      createdAt: new Date().toISOString(),
    })
    .run();
}
