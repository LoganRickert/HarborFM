import { z } from 'zod';

const secretField = z.string().optional();

export const stripeModeSchema = z.enum(['test', 'live']);

export const stripePlanKindSchema = z.enum(['month', 'year', 'one_time']);

export const billingAnchorSchema = z.enum(['anniversary', 'month_start']);

/** POST /stripe/credentials */
export const stripeCredentialsCreateSchema = z.object({
  displayName: z.string().trim().min(1).max(120).default('Stripe'),
  mode: stripeModeSchema.optional().default('test'),
  testSecretKey: secretField,
  testPublishableKey: secretField,
  testWebhookSecret: secretField,
  liveSecretKey: secretField,
  livePublishableKey: secretField,
  liveWebhookSecret: secretField,
});

/** PATCH /stripe/credentials/:id - secrets: omit or "(set)" to keep, "" to clear. Mode is immutable. */
export const stripeCredentialsUpdateSchema = z.object({
  displayName: z.string().trim().min(1).max(120).optional(),
  testSecretKey: secretField,
  testPublishableKey: secretField,
  testWebhookSecret: secretField,
  liveSecretKey: secretField,
  livePublishableKey: secretField,
  liveWebhookSecret: secretField,
});

/** PATCH /podcasts/:id/stripe - attach pack + enable payments + billing anchor */
export const podcastStripeAttachSchema = z.object({
  stripeCredentialsId: z.string().nullable().optional(),
  stripePaymentsEnabled: z.boolean().optional(),
  stripeCheckoutPaused: z.boolean().optional(),
  billingAnchor: billingAnchorSchema.optional(),
});

/** POST /podcasts/:id/stripe/plans */
export const stripePlanCreateSchema = z.object({
  kind: stripePlanKindSchema,
  amountCents: z.number().int().positive().max(99_999_999),
  currency: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z]{3}$/, 'Currency must be a 3-letter code')
    .default('usd'),
  active: z.boolean().optional().default(true),
  autoRenewDefault: z.boolean().optional().default(true),
});

/** PATCH /podcasts/:id/stripe/plans/:planId */
export const stripePlanUpdateSchema = z.object({
  amountCents: z.number().int().positive().max(99_999_999).optional(),
  currency: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z]{3}$/, 'Currency must be a 3-letter code')
    .optional(),
  active: z.boolean().optional(),
  autoRenewDefault: z.boolean().optional(),
});

export const stripeCouponDiscountTypeSchema = z.enum(['percent', 'amount']);
export const stripeCouponDurationSchema = z.enum(['once', 'repeating', 'forever']);

const couponCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(
    /^[A-Za-z0-9-]+$/,
    'Code may only contain letters, numbers, and hyphens',
  )
  .transform((s) => s.toUpperCase());

const optionalIsoDateSchema = z
  .string()
  .trim()
  .refine((s) => Number.isFinite(Date.parse(s)), 'Invalid date')
  .optional()
  .nullable();

/** POST /podcasts/:id/stripe/coupons */
export const stripeCouponCreateSchema = z
  .object({
    code: couponCodeSchema,
    name: z.string().trim().max(120).optional().nullable(),
    discountType: stripeCouponDiscountTypeSchema,
    percentOff: z.number().positive().max(100).optional().nullable(),
    amountOffCents: z.number().int().positive().max(99_999_999).optional().nullable(),
    currency: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z]{3}$/, 'Currency must be a 3-letter code')
      .default('usd'),
    duration: stripeCouponDurationSchema,
    durationInMonths: z.number().int().positive().max(36).optional().nullable(),
    startsAt: optionalIsoDateSchema,
    endsAt: optionalIsoDateSchema,
    maxRedemptions: z.number().int().positive().max(1_000_000).optional().nullable(),
    active: z.boolean().optional().default(true),
  })
  .superRefine((data, ctx) => {
    if (data.discountType === 'percent') {
      if (data.percentOff == null || !(data.percentOff > 0)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Percent off is required',
          path: ['percentOff'],
        });
      }
    } else if (data.amountOffCents == null || !(data.amountOffCents > 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Amount off is required',
        path: ['amountOffCents'],
      });
    }
    if (data.duration === 'repeating') {
      if (data.durationInMonths == null || data.durationInMonths < 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Duration in months is required for repeating coupons',
          path: ['durationInMonths'],
        });
      }
    }
    if (data.startsAt && data.endsAt) {
      const start = Date.parse(data.startsAt);
      const end = Date.parse(data.endsAt);
      if (Number.isFinite(start) && Number.isFinite(end) && end <= start) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'End date must be after start date',
          path: ['endsAt'],
        });
      }
    }
  });

/** PATCH /podcasts/:id/stripe/coupons/:couponId; discount shape is immutable */
export const stripeCouponUpdateSchema = z
  .object({
    name: z.string().trim().max(120).optional().nullable(),
    startsAt: optionalIsoDateSchema,
    endsAt: optionalIsoDateSchema,
    maxRedemptions: z.number().int().positive().max(1_000_000).optional().nullable(),
    active: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.startsAt && data.endsAt) {
      const start = Date.parse(data.startsAt);
      const end = Date.parse(data.endsAt);
      if (Number.isFinite(start) && Number.isFinite(end) && end <= start) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'End date must be after start date',
          path: ['endsAt'],
        });
      }
    }
  });

/** POST /public/podcasts/:slug/stripe/checkout */
export const stripeCheckoutCreateSchema = z.object({
  planId: z.string().trim().min(1),
  episodeAlerts: z.boolean().optional(),
});

/** POST /public/podcasts/:slug/stripe/recover-token */
export const stripeRecoverTokenSchema = z.object({
  email: z.string().trim().email().max(320),
});

/** Optional token body fallback for manage endpoints (cookie is primary). */
export const stripeSubscriberTokenAuthSchema = z.object({
  token: z.string().trim().min(1).optional(),
});

/** POST …/stripe/subscription/portal */
export const stripeSubscriptionPortalSchema = stripeSubscriberTokenAuthSchema.extend({
  returnUrl: z.string().trim().url().optional(),
});

/** POST …/stripe/subscription/cancel-at-period-end */
export const stripeSubscriptionCancelSchema = stripeSubscriberTokenAuthSchema.extend({
  cancel: z.boolean(),
});

/** POST …/stripe/subscription/renew */
export const stripeSubscriptionRenewSchema = stripeSubscriberTokenAuthSchema;

/** POST …/stripe/subscription/regenerate-token */
export const stripeSubscriptionRegenerateSchema = stripeSubscriberTokenAuthSchema;

/** POST …/stripe/subscription/request-refund */
export const stripeSubscriptionRequestRefundSchema = stripeSubscriberTokenAuthSchema;

export type StripeCredentialsCreate = z.infer<typeof stripeCredentialsCreateSchema>;
export type StripeCredentialsUpdate = z.infer<typeof stripeCredentialsUpdateSchema>;
export type PodcastStripeAttach = z.infer<typeof podcastStripeAttachSchema>;
export type StripePlanCreate = z.infer<typeof stripePlanCreateSchema>;
export type StripePlanUpdate = z.infer<typeof stripePlanUpdateSchema>;
export type StripePlanKind = z.infer<typeof stripePlanKindSchema>;
export type BillingAnchor = z.infer<typeof billingAnchorSchema>;
export type StripeMode = z.infer<typeof stripeModeSchema>;
export type StripeCheckoutCreate = z.infer<typeof stripeCheckoutCreateSchema>;
export type StripeRecoverToken = z.infer<typeof stripeRecoverTokenSchema>;
export type StripeSubscriptionPortal = z.infer<typeof stripeSubscriptionPortalSchema>;
export type StripeSubscriptionCancel = z.infer<typeof stripeSubscriptionCancelSchema>;
export type StripeSubscriptionRequestRefund = z.infer<
  typeof stripeSubscriptionRequestRefundSchema
>;
export type StripeCouponDiscountType = z.infer<typeof stripeCouponDiscountTypeSchema>;
export type StripeCouponDuration = z.infer<typeof stripeCouponDurationSchema>;
export type StripeCouponCreate = z.infer<typeof stripeCouponCreateSchema>;
export type StripeCouponUpdate = z.infer<typeof stripeCouponUpdateSchema>;
