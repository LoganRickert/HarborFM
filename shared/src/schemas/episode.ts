import { z } from 'zod';
import {
  chatResponseSchema,
  chatSchema,
  fundingLinkResponseSchema,
  fundingLinkSchema,
  licenseResponseSchema,
  licenseSchema,
  locationResponseSchema,
  locationSchema,
  podcastImageSchema,
  podcastTxtResponseSchema,
  podcastTxtSchema,
  socialInteractResponseSchema,
  socialInteractSchema,
  valueBlockResponseSchema,
  valueBlockSchema,
  PODCAST_NS_URL_MAX,
} from './podcastNamespace.js';

const emptyStringToNull = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === '' ? null : v), schema);

const nullableOptionalUrl = emptyStringToNull(z.string().url().nullable().optional());
const nullableOptionalString = emptyStringToNull(z.string().nullable().optional());

export const episodeTypeSchema = z.enum(['full', 'trailer', 'bonus']).nullable().optional();
export const episodeStatusSchema = z.enum(['draft', 'scheduled', 'published']);

function nonEmptyDate(v: string | null | undefined): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

function expiresAtAfterPublishAt(
  data: { publishAt?: string | null; expiresAt?: string | null },
  ctx: z.RefinementCtx,
) {
  const publishAt = nonEmptyDate(data.publishAt);
  const expiresAt = nonEmptyDate(data.expiresAt);
  if (publishAt == null || expiresAt == null) return;
  if (new Date(expiresAt).getTime() <= new Date(publishAt).getTime()) {
    ctx.addIssue({
      code: 'custom',
      path: ['expiresAt'],
      message: 'Expires at must be after Publish at',
    });
  }
}

function subscriberOnlyWindowOrder(
  data: {
    subscriberOnlyStartsAt?: string | null;
    subscriberOnlyEndsAt?: string | null;
  },
  ctx: z.RefinementCtx,
) {
  const startsAt = nonEmptyDate(data.subscriberOnlyStartsAt);
  const endsAt = nonEmptyDate(data.subscriberOnlyEndsAt);
  if (startsAt == null || endsAt == null) return;
  if (new Date(startsAt).getTime() >= new Date(endsAt).getTime()) {
    ctx.addIssue({
      code: 'custom',
      path: ['subscriberOnlyEndsAt'],
      message: 'Subscriber only until must be after Subscriber only from',
    });
  }
}

const episodeCreateObjectSchema = z.object({
  title: z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.string().min(1, { error: 'Title is required' })),
  description: z.string().default(''),
  subtitle: nullableOptionalString,
  summary: nullableOptionalString,
  contentEncoded: nullableOptionalString,
  slug: z.string().regex(/^[a-z0-9-]+$/, { error: 'Slug: lowercase letters, numbers, hyphens only' }).optional(),
  seasonNumber: z.number().int().min(0).nullable().optional(),
  episodeNumber: z.number().int().min(0).nullable().optional(),
  episodeType: episodeTypeSchema,
  explicit: z.union([z.literal(0), z.literal(1)]).nullable().optional(),
  publishAt: z.string().datetime({ offset: true }).nullable().optional(),
  expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
  status: episodeStatusSchema.default('draft'),
  artworkUrl: nullableOptionalUrl,
  episodeLink: nullableOptionalUrl,
  guidIsPermalink: z.union([z.literal(0), z.literal(1)]).default(0),
});

export const episodeCreateSchema = episodeCreateObjectSchema.superRefine(expiresAtAfterPublishAt);

const subscriberOnlySchema = z.preprocess(
  (v) => (v === true || v === 'true' || v === 1 || v === '1' ? 1 : v === false || v === 'false' || v === 0 || v === '0' ? 0 : v),
  z.union([z.literal(0), z.literal(1)]).optional()
);

const finalMarkerSchema = z.object({
  time: z.number(),
  title: z.string().optional(),
  color: z.string().optional(),
});

const finalSoundbiteSchema = z.object({
  time: z.number().min(0),
  duration: z.number().min(15).max(120),
  title: z.string().optional(),
  color: z.string().optional(),
});

const contentLinkSchema = z.object({
  href: z.string().url().max(PODCAST_NS_URL_MAX),
  text: z.string().max(PODCAST_NS_URL_MAX).optional().nullable(),
});

/**
 * Partial update schema. Do not use episodeCreateSchema.partial() alone: Zod 4 still
 * applies .default() for omitted keys (e.g. description "" / status draft), which
 * wipes fields on narrow PATCHes such as quick publish or chapter edits.
 * Built from the object shape (not the refined create schema) so .omit/.partial work.
 */
export const episodeUpdateSchema = episodeCreateObjectSchema
  .omit({
    description: true,
    status: true,
    guidIsPermalink: true,
  })
  .partial()
  .extend({
    description: z.string().optional(),
    status: episodeStatusSchema.optional(),
    guidIsPermalink: z.union([z.literal(0), z.literal(1)]).optional(),
    slug: z.string().regex(/^[a-z0-9-]+$/, { error: 'Slug: lowercase letters, numbers, hyphens only' }).optional(),
    guid: z.string().min(1, { message: 'GUID cannot be empty' }).optional(),
    subscriberOnly: subscriberOnlySchema,
    subscriberOnlyStartsAt: z.string().datetime({ offset: true }).nullable().optional(),
    subscriberOnlyEndsAt: z.string().datetime({ offset: true }).nullable().optional(),
    /** Chapter markers for the final audio. Overwrites markers from render. */
    finalMarkers: z.array(finalMarkerSchema).optional().nullable(),
    /** Soundbite markers for the final audio. Overwrites markers from render. */
    finalSoundbites: z.array(finalSoundbiteSchema).optional().nullable(),
    /** Podcast 2.0 content links (href + optional label). */
    contentLinks: z.array(contentLinkSchema).optional().nullable(),
    podcastTxts: z.array(podcastTxtSchema).optional().nullable(),
    socialInteracts: z.array(socialInteractSchema).optional().nullable(),
    locations: z.array(locationSchema).optional().nullable(),
    license: licenseSchema.optional().nullable(),
    podcastImages: z.array(podcastImageSchema).optional().nullable(),
    fundingLinks: z.array(fundingLinkSchema).optional().nullable(),
    chat: chatSchema.optional().nullable(),
    valueBlocks: z.array(valueBlockSchema).optional().nullable(),
  })
  .superRefine(expiresAtAfterPublishAt)
  .superRefine(subscriberOnlyWindowOrder);

/** Episode as returned by GET /episodes/:id and list endpoints. Includes server-computed fields. */
export const episodeResponseSchema = z.object({
  id: z.string(),
  podcastId: z.string(),
  title: z.string(),
  slug: z.string(),
  description: z.string(),
  subtitle: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  contentEncoded: z.string().nullable().optional(),
  guid: z.string(),
  seasonNumber: z.number().int().min(0).nullable(),
  episodeNumber: z.number().int().min(0).nullable(),
  episodeType: episodeTypeSchema,
  explicit: z.union([z.literal(0), z.literal(1)]).nullable(),
  publishAt: z.string().nullable(),
  expiresAt: z.string().nullable().optional(),
  status: episodeStatusSchema,
  artworkPath: z.string().nullable(),
  artworkUrl: z.string().nullable(),
  artworkFilename: z.string().nullable().optional(),
  audioSourcePath: z.string().nullable(),
  audioFinalPath: z.string().nullable(),
  audioMime: z.string().nullable(),
  audioBytes: z.number().nullable(),
  audioDurationSec: z.number().nullable(),
  episodeLink: z.string().nullable(),
  guidIsPermalink: z.union([z.literal(0), z.literal(1)]),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** True when the episode has final audio and a transcript.srt file exists. */
  hasTranscript: z.boolean().optional(),
  /** True = omitted from public RSS and episode list; only in tokenized subscriber feed. */
  subscriberOnly: z.boolean().optional(),
  /** When subscriberOnly is on: gating starts at this time (null = immediate). */
  subscriberOnlyStartsAt: z.string().nullable().optional(),
  /** When subscriberOnly is on: gating ends at this time (null = never ends). */
  subscriberOnlyEndsAt: z.string().nullable().optional(),
  /** Chapter markers from segments (marker_type === 'chapter'); time in seconds of final audio. */
  finalMarkers: z.array(z.object({ time: z.number(), title: z.string().optional(), color: z.string().optional() })).optional().nullable(),
  /** Soundbite markers from segments (marker_type === 'soundbite'); time/duration in seconds of final audio. */
  finalSoundbites: z
    .array(
      z.object({
        time: z.number(),
        duration: z.number(),
        title: z.string().optional(),
        color: z.string().optional(),
      }),
    )
    .optional()
    .nullable(),
  /** Podcast 2.0 content links for alternate platforms. */
  contentLinks: z
    .array(
      z.object({
        href: z.string(),
        text: z.string().optional().nullable(),
      }),
    )
    .optional()
    .nullable(),
  podcastTxts: z.array(podcastTxtResponseSchema).optional().nullable(),
  socialInteracts: z.array(socialInteractResponseSchema).optional().nullable(),
  locations: z.array(locationResponseSchema).optional().nullable(),
  license: licenseResponseSchema.optional().nullable(),
  podcastImages: z
    .array(
      z.object({
        href: z.string(),
        alt: z.string().optional().nullable(),
        aspectRatio: z.string().optional().nullable(),
        width: z.number().optional().nullable(),
        height: z.number().optional().nullable(),
        type: z.string().optional().nullable(),
        purpose: z.string().optional().nullable(),
      }),
    )
    .optional()
    .nullable(),
  fundingLinks: z.array(fundingLinkResponseSchema).optional().nullable(),
  chat: chatResponseSchema.optional().nullable(),
  valueBlocks: z.array(valueBlockResponseSchema).optional().nullable(),
  /** Path to generated video (relative to data dir). Present when video has been generated. */
  videoFinalPath: z.string().nullable().optional(),
});

/** Response for GET /podcasts/:podcastId/episodes (list). */
export const episodesResponseSchema = z.object({
  episodes: z.array(episodeResponseSchema),
});

export type EpisodeCreate = z.infer<typeof episodeCreateSchema>;
export type EpisodeUpdate = z.infer<typeof episodeUpdateSchema>;
export type EpisodeResponse = z.infer<typeof episodeResponseSchema>;
export type EpisodesResponse = z.infer<typeof episodesResponseSchema>;
export type EpisodeStatus = z.infer<typeof episodeStatusSchema>;
export type EpisodeType = z.infer<typeof episodeTypeSchema>;
