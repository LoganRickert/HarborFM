import { z } from 'zod';

export const PODCAST_NS_URL_MAX = 2000;

export const podcastTxtSchema = z.object({
  purpose: z.string().max(128).optional().nullable(),
  value: z.string().min(1).max(4000),
});

export const socialInteractSchema = z
  .object({
    protocol: z.string().min(1).max(128),
    uri: z.string().url().max(PODCAST_NS_URL_MAX).optional().nullable(),
    accountId: z.string().max(512).optional().nullable(),
    accountUrl: z.string().url().max(PODCAST_NS_URL_MAX).optional().nullable(),
    priority: z.number().int().min(0).optional().nullable(),
  })
  .superRefine((val, ctx) => {
    if (val.protocol.trim().toLowerCase() !== 'disabled') {
      if (val.uri == null || String(val.uri).trim() === '') {
        ctx.addIssue({
          code: 'custom',
          message: 'uri is required unless protocol is disabled',
          path: ['uri'],
        });
      }
    }
  });

export const locationSchema = z.object({
  name: z.string().min(1).max(128),
  rel: z.enum(['subject', 'creator']).optional().nullable(),
  geo: z.string().max(128).optional().nullable(),
  osm: z.string().max(64).optional().nullable(),
  country: z
    .string()
    .length(2)
    .regex(/^[A-Za-z]{2}$/, { message: 'country must be ISO 3166-1 alpha-2' })
    .optional()
    .nullable(),
});

export const licenseSchema = z.object({
  identifier: z.string().min(1).max(128),
  url: z.string().url().max(PODCAST_NS_URL_MAX).optional().nullable(),
});

export const podcastImageSchema = z.object({
  href: z.string().url().max(PODCAST_NS_URL_MAX),
  alt: z.string().max(512).optional().nullable(),
  aspectRatio: z.string().max(32).optional().nullable(),
  width: z.number().int().positive().optional().nullable(),
  height: z.number().int().positive().optional().nullable(),
  type: z.string().max(128).optional().nullable(),
  purpose: z.string().max(128).optional().nullable(),
});

export const fundingLinkSchema = z.object({
  url: z.string().url().max(PODCAST_NS_URL_MAX),
  text: z.string().max(128).optional().nullable(),
});

export const chatSchema = z.object({
  server: z.string().min(1).max(512),
  protocol: z.string().min(1).max(128),
  accountId: z.string().max(512).optional().nullable(),
  space: z.string().max(512).optional().nullable(),
});

export const valueRecipientSchema = z.object({
  type: z.string().min(1).max(64),
  address: z.string().min(1).max(512),
  split: z.number().int().min(0),
  name: z.string().max(128).optional().nullable(),
  customKey: z.string().max(128).optional().nullable(),
  customValue: z.string().max(512).optional().nullable(),
  fee: z.boolean().optional().nullable(),
});

export const valueBlockSchema = z.object({
  type: z.string().min(1).max(64),
  method: z.string().min(1).max(64),
  suggested: z.string().max(64).optional().nullable(),
  recipients: z.array(valueRecipientSchema).min(1),
});

export const blockSchema = z.object({
  id: z.string().max(128).optional().nullable(),
  value: z.enum(['yes', 'no']),
});

export const publisherSchema = z.object({
  feedGuid: z.string().min(1).max(256),
  feedUrl: z.string().url().max(PODCAST_NS_URL_MAX).optional().nullable(),
  medium: z.string().max(64).optional().nullable(),
});

/**
 * Channel <podcast:podroll> remoteItem.
 * coverArtUrl and homeUrl are HarborFM-only (not emitted in RSS).
 */
export const podrollItemSchema = z.object({
  feedGuid: z.string().min(1).max(256),
  feedUrl: z.string().url().max(PODCAST_NS_URL_MAX).optional().nullable(),
  title: z.string().max(256).optional().nullable(),
  coverArtUrl: z.string().url().max(PODCAST_NS_URL_MAX).optional().nullable(),
  homeUrl: z.string().url().max(PODCAST_NS_URL_MAX).optional().nullable(),
});

export const updateFrequencySchema = z
  .object({
    rrule: z.string().max(512).optional().nullable(),
    label: z.string().max(128).optional().nullable(),
    complete: z.boolean().optional().nullable(),
    dtstart: z.string().max(64).optional().nullable(),
  })
  .superRefine((val, ctx) => {
    const hasComplete = val.complete === true;
    const hasRrule = typeof val.rrule === 'string' && val.rrule.trim().length > 0;
    const hasDtstart = typeof val.dtstart === 'string' && val.dtstart.trim().length > 0;
    const hasLabel = typeof val.label === 'string' && val.label.trim().length > 0;
    if (!hasComplete && !hasRrule && !hasDtstart && !hasLabel) {
      ctx.addIssue({
        code: 'custom',
        message: 'updateFrequency needs complete, rrule, dtstart, or label',
      });
    }
  });

/** Loose response shapes (no URL coercion) for GET payloads. */
export const podcastTxtResponseSchema = z.object({
  purpose: z.string().optional().nullable(),
  value: z.string(),
});

export const socialInteractResponseSchema = z.object({
  protocol: z.string(),
  uri: z.string().optional().nullable(),
  accountId: z.string().optional().nullable(),
  accountUrl: z.string().optional().nullable(),
  priority: z.number().optional().nullable(),
});

export const locationResponseSchema = z.object({
  name: z.string(),
  rel: z.enum(['subject', 'creator']).optional().nullable(),
  geo: z.string().optional().nullable(),
  osm: z.string().optional().nullable(),
  country: z.string().optional().nullable(),
});

export const licenseResponseSchema = z.object({
  identifier: z.string(),
  url: z.string().optional().nullable(),
});

export const fundingLinkResponseSchema = z.object({
  url: z.string(),
  text: z.string().optional().nullable(),
});

export const chatResponseSchema = z.object({
  server: z.string(),
  protocol: z.string(),
  accountId: z.string().optional().nullable(),
  space: z.string().optional().nullable(),
});

export const valueBlockResponseSchema = z.object({
  type: z.string(),
  method: z.string(),
  suggested: z.string().optional().nullable(),
  recipients: z.array(
    z.object({
      type: z.string(),
      address: z.string(),
      split: z.number(),
      name: z.string().optional().nullable(),
      customKey: z.string().optional().nullable(),
      customValue: z.string().optional().nullable(),
      fee: z.boolean().optional().nullable(),
    }),
  ),
});

export const blockResponseSchema = z.object({
  id: z.string().optional().nullable(),
  value: z.enum(['yes', 'no']),
});

export const publisherResponseSchema = z.object({
  feedGuid: z.string(),
  feedUrl: z.string().optional().nullable(),
  medium: z.string().optional().nullable(),
});

export const podrollItemResponseSchema = z.object({
  feedGuid: z.string(),
  feedUrl: z.string().optional().nullable(),
  title: z.string().optional().nullable(),
  coverArtUrl: z.string().optional().nullable(),
  homeUrl: z.string().optional().nullable(),
});

export const updateFrequencyResponseSchema = z.object({
  rrule: z.string().optional().nullable(),
  label: z.string().optional().nullable(),
  complete: z.boolean().optional().nullable(),
  dtstart: z.string().optional().nullable(),
});
