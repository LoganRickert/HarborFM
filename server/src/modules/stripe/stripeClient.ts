import Stripe from "stripe";
import { nanoid } from "nanoid";
import type { StripeMode, StripePlanKind } from "@harborfm/shared";

/** E2E fixture keys never call the real Stripe API. */
export function isE2eStripeSecret(secretKey: string): boolean {
  return /_(?:e2e)_/i.test(secretKey) || secretKey.includes("e2e_secret");
}

export function createStripeClient(secretKey: string): Stripe {
  return new Stripe(secretKey, {
    apiVersion: "2026-06-24.dahlia",
  });
}

function kindLabel(kind: StripePlanKind): string {
  if (kind === "month") return "Monthly";
  if (kind === "year") return "Yearly";
  return "One-time";
}

export function productDashboardUrl(
  productId: string,
  mode: StripeMode,
): string {
  if (mode === "live") {
    return `https://dashboard.stripe.com/products/${encodeURIComponent(productId)}`;
  }
  return `https://dashboard.stripe.com/test/products/${encodeURIComponent(productId)}`;
}

export function subscriptionDashboardUrl(
  subscriptionId: string,
  mode: StripeMode,
): string {
  if (mode === "live") {
    return `https://dashboard.stripe.com/subscriptions/${encodeURIComponent(subscriptionId)}`;
  }
  return `https://dashboard.stripe.com/test/subscriptions/${encodeURIComponent(subscriptionId)}`;
}

export function customerDashboardUrl(
  customerId: string,
  mode: StripeMode,
): string {
  if (mode === "live") {
    return `https://dashboard.stripe.com/customers/${encodeURIComponent(customerId)}`;
  }
  return `https://dashboard.stripe.com/test/customers/${encodeURIComponent(customerId)}`;
}

export type SyncedStripeIds = {
  stripeProductId: string;
  stripePriceId: string;
};

export async function createProductAndPrice(opts: {
  secretKey: string;
  podcastId: string;
  planId: string;
  podcastTitle: string;
  kind: StripePlanKind;
  amountCents: number;
  currency: string;
  imageUrl?: string | null;
}): Promise<SyncedStripeIds> {
  const {
    secretKey,
    podcastId,
    planId,
    podcastTitle,
    kind,
    amountCents,
    currency,
    imageUrl,
  } = opts;
  const metadata = {
    harborfm_podcast_id: podcastId,
    harborfm_plan_id: planId,
  };
  const name = `${podcastTitle} - ${kindLabel(kind)}`;

  if (isE2eStripeSecret(secretKey)) {
    return {
      stripeProductId: `prod_e2e_${nanoid(10)}`,
      stripePriceId: `price_e2e_${nanoid(10)}`,
    };
  }

  const stripe = createStripeClient(secretKey);
  const productParams: Stripe.ProductCreateParams = {
    name,
    metadata,
  };
  if (imageUrl) {
    productParams.images = [imageUrl];
  }

  let product: Stripe.Product;
  try {
    product = await stripe.products.create(productParams);
  } catch (err) {
    // Stripe must fetch images; bad/unreachable URLs should not block plan creation
    if (imageUrl) {
      product = await stripe.products.create({ name, metadata });
    } else {
      throw err;
    }
  }

  const priceParams: Stripe.PriceCreateParams = {
    product: product.id,
    unit_amount: amountCents,
    currency,
    metadata,
  };
  if (kind === "month") {
    priceParams.recurring = { interval: "month" };
  } else if (kind === "year") {
    priceParams.recurring = { interval: "year" };
  }
  const price = await stripe.prices.create(priceParams);
  return { stripeProductId: product.id, stripePriceId: price.id };
}

export async function replacePrice(opts: {
  secretKey: string;
  podcastId: string;
  planId: string;
  stripeProductId: string;
  oldStripePriceId: string;
  kind: StripePlanKind;
  amountCents: number;
  currency: string;
}): Promise<{ stripePriceId: string }> {
  const {
    secretKey,
    podcastId,
    planId,
    stripeProductId,
    oldStripePriceId,
    kind,
    amountCents,
    currency,
  } = opts;
  const metadata = {
    harborfm_podcast_id: podcastId,
    harborfm_plan_id: planId,
  };

  if (isE2eStripeSecret(secretKey)) {
    return { stripePriceId: `price_e2e_${nanoid(10)}` };
  }

  const stripe = createStripeClient(secretKey);
  const priceParams: Stripe.PriceCreateParams = {
    product: stripeProductId,
    unit_amount: amountCents,
    currency,
    metadata,
  };
  if (kind === "month") {
    priceParams.recurring = { interval: "month" };
  } else if (kind === "year") {
    priceParams.recurring = { interval: "year" };
  }
  const price = await stripe.prices.create(priceParams);
  try {
    await stripe.prices.update(oldStripePriceId, { active: false });
  } catch {
    // Best-effort archive of previous price
  }
  return { stripePriceId: price.id };
}

export async function setProductActive(opts: {
  secretKey: string;
  stripeProductId: string;
  active: boolean;
}): Promise<void> {
  if (isE2eStripeSecret(opts.secretKey)) return;
  if (!opts.stripeProductId) return;
  const stripe = createStripeClient(opts.secretKey);
  await stripe.products.update(opts.stripeProductId, { active: opts.active });
}

export async function archiveProductAndPrice(opts: {
  secretKey: string;
  stripeProductId: string;
  stripePriceId: string;
}): Promise<void> {
  if (isE2eStripeSecret(opts.secretKey)) return;
  const stripe = createStripeClient(opts.secretKey);
  try {
    if (opts.stripePriceId) {
      await stripe.prices.update(opts.stripePriceId, { active: false });
    }
  } catch {
    /* ignore */
  }
  try {
    if (opts.stripeProductId) {
      await stripe.products.update(opts.stripeProductId, { active: false });
    }
  } catch {
    /* ignore */
  }
}

export function couponDashboardUrl(
  couponId: string,
  mode: StripeMode,
): string {
  if (mode === "live") {
    return `https://dashboard.stripe.com/coupons/${encodeURIComponent(couponId)}`;
  }
  return `https://dashboard.stripe.com/test/coupons/${encodeURIComponent(couponId)}`;
}

export type SyncedCouponIds = {
  stripeCouponId: string;
  stripePromotionCodeId: string;
};

export async function createCouponAndPromotionCode(opts: {
  secretKey: string;
  podcastId: string;
  couponId: string;
  mode: StripeMode;
  code: string;
  name?: string | null;
  discountType: "percent" | "amount";
  percentOff?: number | null;
  amountOffCents?: number | null;
  currency: string;
  duration: "once" | "repeating" | "forever";
  durationInMonths?: number | null;
  endsAt?: string | null;
  maxRedemptions?: number | null;
  promoActive: boolean;
}): Promise<SyncedCouponIds> {
  const metadata = {
    harborfm_podcast_id: opts.podcastId,
    harborfm_coupon_id: opts.couponId,
    harborfm_mode: opts.mode,
  };

  if (isE2eStripeSecret(opts.secretKey)) {
    return {
      stripeCouponId: `coupon_e2e_${nanoid(10)}`,
      stripePromotionCodeId: `promo_e2e_${nanoid(10)}`,
    };
  }

  const stripe = createStripeClient(opts.secretKey);
  const couponParams: Stripe.CouponCreateParams = {
    duration: opts.duration,
    metadata,
    name: opts.name?.trim() || opts.code,
  };
  if (opts.discountType === "percent") {
    couponParams.percent_off = opts.percentOff ?? undefined;
  } else {
    couponParams.amount_off = opts.amountOffCents ?? undefined;
    couponParams.currency = opts.currency;
  }
  if (opts.duration === "repeating" && opts.durationInMonths) {
    couponParams.duration_in_months = opts.durationInMonths;
  }
  if (opts.maxRedemptions != null && opts.maxRedemptions > 0) {
    couponParams.max_redemptions = opts.maxRedemptions;
  }
  if (opts.endsAt) {
    const ms = Date.parse(opts.endsAt);
    if (Number.isFinite(ms)) {
      couponParams.redeem_by = Math.floor(ms / 1000);
    }
  }

  const coupon = await stripe.coupons.create(couponParams);

  const promoParams: Stripe.PromotionCodeCreateParams = {
    promotion: {
      type: "coupon",
      coupon: coupon.id,
    },
    code: opts.code,
    active: opts.promoActive,
    metadata,
  };
  if (opts.maxRedemptions != null && opts.maxRedemptions > 0) {
    promoParams.max_redemptions = opts.maxRedemptions;
  }
  if (opts.endsAt) {
    const ms = Date.parse(opts.endsAt);
    if (Number.isFinite(ms)) {
      promoParams.expires_at = Math.floor(ms / 1000);
    }
  }

  const promo = await stripe.promotionCodes.create(promoParams);
  return {
    stripeCouponId: coupon.id,
    stripePromotionCodeId: promo.id,
  };
}

export async function updatePromotionCode(opts: {
  secretKey: string;
  stripePromotionCodeId: string;
  active?: boolean;
  expiresAt?: string | null;
}): Promise<void> {
  if (isE2eStripeSecret(opts.secretKey)) return;
  if (!opts.stripePromotionCodeId) return;
  const stripe = createStripeClient(opts.secretKey);
  const params: Stripe.PromotionCodeUpdateParams = {};
  if (opts.active !== undefined) {
    params.active = opts.active;
  }
  // Stripe does not allow changing expires_at on update in all API versions;
  // active toggle is the primary control for start/end windows we manage locally.
  await stripe.promotionCodes.update(opts.stripePromotionCodeId, params);
}

export async function deactivateCouponAndPromotionCode(opts: {
  secretKey: string;
  stripeCouponId: string;
  stripePromotionCodeId: string;
}): Promise<void> {
  if (isE2eStripeSecret(opts.secretKey)) return;
  const stripe = createStripeClient(opts.secretKey);
  try {
    if (opts.stripePromotionCodeId) {
      await stripe.promotionCodes.update(opts.stripePromotionCodeId, {
        active: false,
      });
    }
  } catch {
    /* ignore */
  }
  try {
    if (opts.stripeCouponId) {
      await stripe.coupons.del(opts.stripeCouponId);
    }
  } catch {
    /* ignore */
  }
}
