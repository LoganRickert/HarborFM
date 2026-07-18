import { z } from 'zod';
import {
  blockSchema,
  chatSchema,
  fundingLinkSchema,
  licenseSchema,
  locationSchema,
  podcastTxtSchema,
  podrollItemSchema,
  publisherSchema,
  socialInteractSchema,
  updateFrequencySchema,
  valueBlockSchema,
} from './podcastNamespace.js';

const emptyStringToNull = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === '' ? null : v), schema);

const nullableOptionalString = emptyStringToNull(z.string().nullable().optional());
const nullableOptionalUrl = emptyStringToNull(z.string().url().nullable().optional());

/** Named accent for public feed page theming. */
export const feedAccentSchema = z.enum([
  'green',
  'cyan',
  'blue',
  'indigo',
  'violet',
  'pink',
  'red',
  'orange',
  'amber',
  'lime',
]);

export type FeedAccent = z.infer<typeof feedAccentSchema>;

export const podcastCreateSchema = z.object({
  title: z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.string().min(1, { error: 'Title is required' })),
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/, { error: 'Slug: lowercase letters, numbers, hyphens only' }),
  description: z.string().default(''),
  subtitle: nullableOptionalString,
  summary: nullableOptionalString,
  language: z.string().length(2).default('en'),
  authorName: z.string().default(''),
  ownerName: z.string().default(''),
  email: z.string().email().optional().or(z.literal('')),
  categoryPrimary: z.string().default(''),
  categorySecondary: nullableOptionalString,
  categoryPrimaryTwo: nullableOptionalString,
  categorySecondaryTwo: nullableOptionalString,
  categoryPrimaryThree: nullableOptionalString,
  categorySecondaryThree: nullableOptionalString,
  explicit: z.union([z.literal(0), z.literal(1)]).default(0),
  siteUrl: nullableOptionalUrl,
  // allow any string here (some users paste non-standard URLs); normalize '' -> null
  artworkUrl: emptyStringToNull(z.string().nullable().optional()),
  copyright: nullableOptionalString,
  // GUID can be any persistent string (UUID, URL, or feed-specific id)
  podcastGuid: nullableOptionalString,
  locked: z.union([z.literal(0), z.literal(1)]).default(0),
  license: licenseSchema.optional().nullable(),
  itunesType: z.enum(['episodic', 'serial']).default('episodic'),
  medium: z.enum(['podcast', 'music', 'video', 'film', 'audiobook', 'newsletter', 'blog']).default('podcast'),
  fundingLinks: z.array(fundingLinkSchema).optional().nullable(),
  persons: nullableOptionalString,
  updateFrequency: z.preprocess((v) => {
    if (v == null || v === '') return null;
    if (typeof v !== 'object' || Array.isArray(v)) return v;
    const o = v as Record<string, unknown>;
    const empty =
      o.complete !== true &&
      !(typeof o.rrule === 'string' && o.rrule.trim()) &&
      !(typeof o.dtstart === 'string' && o.dtstart.trim()) &&
      !(typeof o.label === 'string' && o.label.trim());
    return empty ? null : v;
  }, updateFrequencySchema.nullable().optional()),
  podcastTxts: z.array(podcastTxtSchema).optional().nullable(),
  socialInteracts: z.array(socialInteractSchema).optional().nullable(),
  locations: z.array(locationSchema).optional().nullable(),
  chat: chatSchema.optional().nullable(),
  valueBlocks: z.array(valueBlockSchema).optional().nullable(),
  blocks: z.array(blockSchema).optional().nullable(),
  publisher: publisherSchema.optional().nullable(),
  podroll: z.array(podrollItemSchema).optional().nullable(),
  spotifyRecentCount: z.number().int().min(0).nullable().optional(),
  spotifyCountryOfOrigin: nullableOptionalString,
  applePodcastsVerify: nullableOptionalString,
  applePodcastsUrl: nullableOptionalUrl,
  spotifyUrl: nullableOptionalUrl,
  amazonMusicUrl: nullableOptionalUrl,
  podcastIndexUrl: nullableOptionalUrl,
  listenNotesUrl: nullableOptionalUrl,
  castboxUrl: nullableOptionalUrl,
  xUrl: nullableOptionalUrl,
  facebookUrl: nullableOptionalUrl,
  instagramUrl: nullableOptionalUrl,
  tiktokUrl: nullableOptionalUrl,
  youtubeUrl: nullableOptionalUrl,
  discordUrl: nullableOptionalUrl,
});

/**
 * Partial update schema. Do not use podcastCreateSchema.partial() alone: Zod 4 still
 * applies .default() for omitted keys, which would wipe description and other fields
 * on narrow PATCHes (e.g. enabling subscriber tokens).
 */
export const podcastUpdateSchema = podcastCreateSchema
  .omit({
    description: true,
    language: true,
    authorName: true,
    ownerName: true,
    categoryPrimary: true,
    explicit: true,
    locked: true,
    itunesType: true,
    medium: true,
  })
  .partial()
  .extend({
    description: z.string().optional(),
    language: z.string().length(2).optional(),
    authorName: z.string().optional(),
    ownerName: z.string().optional(),
    categoryPrimary: z.string().optional(),
    explicit: z.union([z.literal(0), z.literal(1)]).optional(),
    locked: z.union([z.literal(0), z.literal(1)]).optional(),
    itunesType: z.enum(['episodic', 'serial']).optional(),
    medium: z.enum(['podcast', 'music', 'video', 'film', 'audiobook', 'newsletter', 'blog']).optional(),
    maxCollaborators: z.number().int().min(0).nullable().optional(),
    unlisted: z.union([z.literal(0), z.literal(1)]).optional(),
    /** Accept boolean or 0/1 (e.g. from GET response or form state). */
    subscriberOnlyFeedEnabled: z.union([z.boolean(), z.literal(0), z.literal(1)]).optional(),
    /** When true, public RSS and public episode list/page do not load (subscriber-only show). Accept boolean or 0/1. */
    publicFeedDisabled: z.union([z.boolean(), z.literal(0), z.literal(1)]).optional(),
    /** When true, show unapproved reviews on the public feed (default true). */
    allowUnapprovedReviews: z.union([z.boolean(), z.literal(0), z.literal(1)]).optional(),
    /** When true, only subscribers can leave reviews (requires subscriberOnlyFeedEnabled). Accept boolean or 0/1. */
    subscriberOnlyReviews: z.union([z.boolean(), z.literal(0), z.literal(1)]).optional(),
    /** When true, only subscribers can see/use Message button and submit contact for this show (requires subscriberOnlyFeedEnabled). Accept boolean or 0/1. */
    subscriberOnlyMessages: z.union([z.boolean(), z.literal(0), z.literal(1)]).optional(),
    /** When true, episodes scheduled for a future date appear on the public feed with a placeholder. Accept boolean or 0/1. */
    showScheduledEpisodes: z.union([z.boolean(), z.literal(0), z.literal(1)]).optional(),
    /** When true, expired episodes remain in subscriber/private feeds. Public always hides them. Accept boolean or 0/1. */
    subscribersKeepExpiredEpisodes: z.union([z.boolean(), z.literal(0), z.literal(1)]).optional(),
    /** Primary accent color for the public feed page. */
    feedAccent: feedAccentSchema.optional(),
    feedShowPodcastDescription: z.union([z.boolean(), z.literal(0), z.literal(1)]).optional(),
    feedShowEpisodeDescription: z.union([z.boolean(), z.literal(0), z.literal(1)]).optional(),
    feedShowFunding: z.union([z.boolean(), z.literal(0), z.literal(1)]).optional(),
    feedShowReviewsPodcast: z.union([z.boolean(), z.literal(0), z.literal(1)]).optional(),
    feedShowReviewsEpisode: z.union([z.boolean(), z.literal(0), z.literal(1)]).optional(),
    feedShowAuthor: z.union([z.boolean(), z.literal(0), z.literal(1)]).optional(),
    feedShowPodroll: z.union([z.boolean(), z.literal(0), z.literal(1)]).optional(),
    feedShowCast: z.union([z.boolean(), z.literal(0), z.literal(1)]).optional(),
    /** DNS: link domain (hostname only, no https://). */
    linkDomain: z.string().nullable().optional(),
    /** DNS: managed domain (hostname only, no https://). */
    managedDomain: z.string().nullable().optional(),
    /** DNS: managed sub-domain (reject www and @). */
    managedSubDomain: z
      .string()
      .nullable()
      .optional()
      .refine((v) => v == null || v === '' || (v !== 'www' && v !== '@'), {
        message: 'Reserved values www and @ are not allowed',
      }),
    /** DNS: Cloudflare API key (plaintext; server encrypts before storing). Send null to clear. */
    cloudflareApiKey: z.string().nullable().optional(),
  });

/** Body for POST /podcasts/import: feed URL (RSS or Atom). */
export const podcastImportBodySchema = z.object({
  feedUrl: z
    .string()
    .min(1, { message: 'feedUrl is required' })
    .transform((s) => s.trim())
    .refine((s) => {
      try {
        const u = new URL(s);
        return u.protocol === 'http:' || u.protocol === 'https:';
      } catch {
        return false;
      }
    }, { message: 'feedUrl must be a valid http or https URL' }),
});

/** Body for POST /podcasts/feed-preview (podroll RSS autofill). */
export const podcastFeedPreviewBodySchema = podcastImportBodySchema;

export type PodcastImportBody = z.infer<typeof podcastImportBodySchema>;
export type PodcastFeedPreviewBody = z.infer<typeof podcastFeedPreviewBodySchema>;

export type PodcastCreate = z.infer<typeof podcastCreateSchema>;
export type PodcastUpdate = z.infer<typeof podcastUpdateSchema>;

/** Body for PATCH /podcasts/:podcastId/subscriber-tokens/:id */
export const subscriberTokenUpdateSchema = z.object({
  disabled: z.boolean().optional(),
  validUntil: z.string().optional(),
  validFrom: z.string().optional(),
});

export type SubscriberTokenUpdate = z.infer<typeof subscriberTokenUpdateSchema>;

/** Query params for GET /podcasts (list podcasts) */
export const podcastsListQuerySchema = z.object({
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).optional(),
  q: z.string().optional(),
  sort: z.enum(['newest', 'oldest']).optional(),
});

export type PodcastsListQuery = z.infer<typeof podcastsListQuerySchema>;

/** Body for POST /podcasts/:podcastId/collaborators (add collaborator). */
export const podcastCollaboratorAddBodySchema = z.object({
  /** Email address or username (handle). If input contains @, lookup by email; otherwise by username. */
  email: z.string().min(1, { message: 'Email or username is required' }),
  role: z.enum(['view', 'editor', 'manager'], { message: 'Invalid role. Use view, editor, or manager.' }),
});

/** Body for PATCH /podcasts/:podcastId/collaborators/:userId (update role). */
export const podcastCollaboratorUpdateBodySchema = z.object({
  role: z.enum(['view', 'editor', 'manager'], { message: 'Invalid role. Use view, editor, or manager.' }),
});

/** Query params for GET /podcasts/:id/analytics (filter and paginate daily stats). */
const dateYYYYMMDD = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'Date must be YYYY-MM-DD' });

export const podcastAnalyticsQuerySchema = z
  .object({
    startDate: dateYYYYMMDD.optional(),
    endDate: dateYYYYMMDD.optional(),
    limit: z.coerce.number().int().min(1).optional(),
    offset: z.coerce.number().int().min(0).optional(),
  })
  .refine(
    (data) => {
      if (data.startDate != null && data.endDate != null) return data.startDate <= data.endDate;
      return true;
    },
    { message: 'startDate must be <= endDate', path: ['endDate'] }
  );

export type PodcastAnalyticsQuery = z.infer<typeof podcastAnalyticsQuerySchema>;

/** Query or body for RSS routes (public_base_url override). */
export const rssPublicBaseUrlQuerySchema = z.object({
  publicBaseUrl: z.string().url().optional().or(z.literal('')),
}).transform((o) => ({ publicBaseUrl: o.publicBaseUrl?.trim() || undefined }));

export const rssPublicBaseUrlBodySchema = z.object({
  publicBaseUrl: z.string().url().optional().or(z.literal('')),
}).transform((o) => ({ publicBaseUrl: o.publicBaseUrl?.trim() || undefined }));

export type PodcastCollaboratorAddBody = z.infer<typeof podcastCollaboratorAddBodySchema>;
export type PodcastCollaboratorUpdateBody = z.infer<typeof podcastCollaboratorUpdateBodySchema>;
export type RssPublicBaseUrlQuery = z.infer<typeof rssPublicBaseUrlQuerySchema>;
export type RssPublicBaseUrlBody = z.infer<typeof rssPublicBaseUrlBodySchema>;
