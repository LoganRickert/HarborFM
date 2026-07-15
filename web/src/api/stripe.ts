import { apiGet, apiPost, apiPatch, apiDelete } from './client';

export type StripeMode = 'test' | 'live';
export type StripePlanKind = 'month' | 'year' | 'one_time';
export type BillingAnchor = 'anniversary' | 'month_start';

export interface StripeCredentials {
  id: string;
  ownerUserId: string;
  displayName: string;
  mode: StripeMode;
  testSecretKeySet: boolean;
  testPublishableKeySet: boolean;
  testWebhookSecretSet: boolean;
  liveSecretKeySet: boolean;
  livePublishableKeySet: boolean;
  liveWebhookSecretSet: boolean;
  activeSecretKeySet: boolean;
  webhookUrl: string;
  publishableKey?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StripeCredentialsInput {
  displayName?: string;
  mode?: StripeMode;
  testSecretKey?: string;
  testPublishableKey?: string;
  testWebhookSecret?: string;
  liveSecretKey?: string;
  livePublishableKey?: string;
  liveWebhookSecret?: string;
}

export interface PodcastStripeCredentialsResponse {
  credentials: StripeCredentials[];
  stripeCredentialsId: string | null;
  stripePaymentsEnabled: boolean;
  billingAnchor: BillingAnchor;
  canEditPacks: boolean;
}

export interface PodcastStripeStatus {
  stripeCredentialsId: string | null;
  stripePaymentsEnabled: boolean;
  billingAnchor: BillingAnchor;
  canEditPacks: boolean;
  credentials: StripeCredentials | null;
}

export interface StripePlan {
  id: string;
  podcastId: string;
  mode: StripeMode;
  kind: StripePlanKind;
  amountCents: number;
  currency: string;
  active: boolean;
  stripeProductId: string;
  stripePriceId: string;
  autoRenewDefault: boolean;
  syncError: string | null;
  productUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StripePlanInput {
  kind: StripePlanKind;
  amountCents: number;
  currency?: string;
  active?: boolean;
  autoRenewDefault?: boolean;
}

export interface StripePlanUpdateInput {
  amountCents?: number;
  currency?: string;
  active?: boolean;
  autoRenewDefault?: boolean;
}

export function listMyStripeCredentials() {
  return apiGet<{ credentials: StripeCredentials[] }>('/stripe/credentials');
}

export function createStripeCredentials(body: StripeCredentialsInput) {
  return apiPost<StripeCredentials>('/stripe/credentials', body);
}

export function getStripeCredentials(id: string) {
  return apiGet<StripeCredentials>(`/stripe/credentials/${id}`);
}

export function updateStripeCredentials(id: string, body: StripeCredentialsInput) {
  return apiPatch<StripeCredentials>(`/stripe/credentials/${id}`, body);
}

export type StripeVerifyCheckStatus = 'ok' | 'fail' | 'unknown';

export interface StripeVerifyCheck {
  id: string;
  label: string;
  status: StripeVerifyCheckStatus;
  detail?: string;
}

export interface StripeVerifyResult {
  ok: boolean;
  checks: StripeVerifyCheck[];
}

export function verifyStripeCredentials(id: string) {
  return apiPost<StripeVerifyResult>(`/stripe/credentials/${id}/verify`);
}

export function deleteStripeCredentials(id: string) {
  return apiDelete<{ ok: boolean }>(`/stripe/credentials/${id}`);
}

export function listPodcastStripeCredentials(podcastId: string) {
  return apiGet<PodcastStripeCredentialsResponse>(
    `/podcasts/${podcastId}/stripe/credentials`,
  );
}

export function getPodcastStripeStatus(podcastId: string) {
  return apiGet<PodcastStripeStatus>(`/podcasts/${podcastId}/stripe/status`);
}

export function updatePodcastStripe(
  podcastId: string,
  body: {
    stripeCredentialsId?: string | null;
    stripePaymentsEnabled?: boolean;
    billingAnchor?: BillingAnchor;
  },
) {
  return apiPatch<{
    stripeCredentialsId: string | null;
    stripePaymentsEnabled: boolean;
    billingAnchor: BillingAnchor;
    credentials: StripeCredentials | null;
  }>(`/podcasts/${podcastId}/stripe`, body);
}

export type StripeSubscriberCounts = {
  month: number;
  year: number;
  one_time: number;
  total: number;
  /** Sum of active monthly plan prices (/ month). */
  monthRevenueCents: number;
  /** Sum of active yearly plan prices (/ year). */
  yearRevenueCents: number;
  /** Sum paid (or plan price) for one-time purchases. */
  oneTimeRevenueCents: number;
  currency: string | null;
};

export function listPodcastStripePlans(podcastId: string) {
  return apiGet<{
    mode: StripeMode | null;
    billingAnchor: BillingAnchor;
    plans: StripePlan[];
    subscriberCounts: StripeSubscriberCounts;
  }>(`/podcasts/${podcastId}/stripe/plans`);
}

export function createPodcastStripePlan(podcastId: string, body: StripePlanInput) {
  return apiPost<StripePlan>(`/podcasts/${podcastId}/stripe/plans`, body);
}

export function updatePodcastStripePlan(
  podcastId: string,
  planId: string,
  body: StripePlanUpdateInput,
) {
  return apiPatch<StripePlan>(`/podcasts/${podcastId}/stripe/plans/${planId}`, body);
}

export function deletePodcastStripePlan(podcastId: string, planId: string) {
  return apiDelete<{ ok: boolean }>(`/podcasts/${podcastId}/stripe/plans/${planId}`);
}

export type StripeCouponDiscountType = 'percent' | 'amount';
export type StripeCouponDuration = 'once' | 'repeating' | 'forever';

export type StripeCouponRedemption = {
  id: string;
  subscriptionId: string;
  customerEmail: string | null;
  createdAt: string;
  amountOffCents: number | null;
  percentOff: number | null;
};

export type StripeCoupon = {
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
  redemptions: StripeCouponRedemption[];
  createdAt: string;
  updatedAt: string;
};

export type StripeCouponCreateInput = {
  code: string;
  name?: string | null;
  discountType: StripeCouponDiscountType;
  percentOff?: number | null;
  amountOffCents?: number | null;
  currency?: string;
  duration: StripeCouponDuration;
  durationInMonths?: number | null;
  startsAt?: string | null;
  endsAt?: string | null;
  maxRedemptions?: number | null;
  active?: boolean;
};

export type StripeCouponUpdateInput = {
  name?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  maxRedemptions?: number | null;
  active?: boolean;
};

export function listPodcastStripeCoupons(podcastId: string) {
  return apiGet<{ mode: StripeMode | null; coupons: StripeCoupon[] }>(
    `/podcasts/${podcastId}/stripe/coupons`,
  );
}

export function createPodcastStripeCoupon(
  podcastId: string,
  body: StripeCouponCreateInput,
) {
  return apiPost<StripeCoupon>(`/podcasts/${podcastId}/stripe/coupons`, body);
}

export function updatePodcastStripeCoupon(
  podcastId: string,
  couponId: string,
  body: StripeCouponUpdateInput,
) {
  return apiPatch<StripeCoupon>(
    `/podcasts/${podcastId}/stripe/coupons/${couponId}`,
    body,
  );
}

export function deletePodcastStripeCoupon(podcastId: string, couponId: string) {
  return apiDelete<{ ok: boolean }>(
    `/podcasts/${podcastId}/stripe/coupons/${couponId}`,
  );
}

export type StripeRefundRequest = {
  id: string;
  status: 'pending' | 'approved' | 'rejected';
  amountCents: number;
  currency: string;
  customerEmail: string | null;
  planKind: string | null;
  createdAt: string;
  resolvedAt: string | null;
};

export function listPodcastStripeRefundRequests(podcastId: string) {
  return apiGet<{ refundRequests: StripeRefundRequest[] }>(
    `/podcasts/${podcastId}/stripe/refund-requests`,
  );
}

export function approvePodcastStripeRefundRequest(podcastId: string, requestId: string) {
  return apiPost<{ refundRequest: StripeRefundRequest }>(
    `/podcasts/${podcastId}/stripe/refund-requests/${encodeURIComponent(requestId)}/approve`,
    {},
  );
}

export function rejectPodcastStripeRefundRequest(podcastId: string, requestId: string) {
  return apiPost<{ refundRequest: StripeRefundRequest }>(
    `/podcasts/${podcastId}/stripe/refund-requests/${encodeURIComponent(requestId)}/reject`,
    {},
  );
}

export type OwnerStripeSubscription = {
  id: string;
  status: string;
  mode: StripeMode;
  planKind: StripePlanKind | null;
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

export function listPodcastStripeSubscriptions(
  podcastId: string,
  opts?: {
    limit?: number;
    offset?: number;
    q?: string;
    sort?: 'newest' | 'oldest';
  },
) {
  const params = new URLSearchParams();
  if (opts?.limit != null) params.set('limit', String(opts.limit));
  if (opts?.offset != null) params.set('offset', String(opts.offset));
  if (opts?.q) params.set('q', opts.q);
  if (opts?.sort) params.set('sort', opts.sort);
  const qs = params.toString();
  return apiGet<{
    subscriptions: OwnerStripeSubscription[];
    total: number;
  }>(`/podcasts/${podcastId}/stripe/subscriptions${qs ? `?${qs}` : ''}`);
}

export function cancelPodcastStripeSubscriptionAutoRenew(
  podcastId: string,
  subscriptionId: string,
) {
  return apiPost<{ subscription: OwnerStripeSubscription }>(
    `/podcasts/${podcastId}/stripe/subscriptions/${encodeURIComponent(subscriptionId)}/cancel-auto-renew`,
    {},
  );
}

export function deletePodcastStripeSubscription(
  podcastId: string,
  subscriptionId: string,
) {
  return apiDelete<{ ok: boolean }>(
    `/podcasts/${podcastId}/stripe/subscriptions/${encodeURIComponent(subscriptionId)}`,
  );
}

export function getStripeUserStatus() {
  return apiGet<{ canStripe: boolean; configured: boolean }>('/stripe/status');
}
