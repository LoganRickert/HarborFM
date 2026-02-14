import { z } from 'zod';

const emptyStringToNull = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === '' ? null : v), schema);

const nullableOptionalString = emptyStringToNull(z.string().nullable().optional());
const nullableOptionalUrl = emptyStringToNull(z.string().url().nullable().optional());

export const podcastCreateSchema = z.object({
  title: z.string().min(1, { error: 'Title is required' }),
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/, { error: 'Slug: lowercase letters, numbers, hyphens only' }),
  description: z.string().default(''),
  subtitle: nullableOptionalString,
  summary: nullableOptionalString,
  language: z.string().length(2).default('en'),
  author_name: z.string().default(''),
  owner_name: z.string().default(''),
  email: z.string().email().optional().or(z.literal('')),
  category_primary: z.string().default(''),
  category_secondary: nullableOptionalString,
  category_primary_two: nullableOptionalString,
  category_secondary_two: nullableOptionalString,
  category_primary_three: nullableOptionalString,
  category_secondary_three: nullableOptionalString,
  explicit: z.union([z.literal(0), z.literal(1)]).default(0),
  site_url: nullableOptionalUrl,
  // allow any string here (some users paste non-standard URLs); normalize '' -> null
  artwork_url: emptyStringToNull(z.string().nullable().optional()),
  copyright: nullableOptionalString,
  // GUID can be any persistent string (UUID, URL, or feed-specific id)
  podcast_guid: nullableOptionalString,
  locked: z.union([z.literal(0), z.literal(1)]).default(0),
  license: nullableOptionalString,
  itunes_type: z.enum(['episodic', 'serial']).default('episodic'),
  medium: z.enum(['podcast', 'music', 'video', 'film', 'audiobook', 'newsletter', 'blog']).default('podcast'),
  funding_url: emptyStringToNull(z.string().url().nullable().optional()),
  funding_label: nullableOptionalString,
  persons: nullableOptionalString,
  update_frequency_rrule: nullableOptionalString,
  update_frequency_label: nullableOptionalString,
  spotify_recent_count: z.number().int().min(0).nullable().optional(),
  spotify_country_of_origin: nullableOptionalString,
  apple_podcasts_verify: nullableOptionalString,
  apple_podcasts_url: nullableOptionalUrl,
  spotify_url: nullableOptionalUrl,
  amazon_music_url: nullableOptionalUrl,
  podcast_index_url: nullableOptionalUrl,
  listen_notes_url: nullableOptionalUrl,
  castbox_url: nullableOptionalUrl,
  x_url: nullableOptionalUrl,
  facebook_url: nullableOptionalUrl,
  instagram_url: nullableOptionalUrl,
  tiktok_url: nullableOptionalUrl,
  youtube_url: nullableOptionalUrl,
});

/** Partial of create schema plus optional per-podcast limits and flags. */
export const podcastUpdateSchema = podcastCreateSchema.partial().extend({
  max_collaborators: z.number().int().min(0).nullable().optional(),
  unlisted: z.union([z.literal(0), z.literal(1)]).optional(),
  subscriber_only_feed_enabled: z.union([z.literal(0), z.literal(1)]).optional(),
  /** When 1, public RSS and public episode list/page do not load (subscriber-only show). */
  public_feed_disabled: z.union([z.literal(0), z.literal(1)]).optional(),
  /** DNS: link domain (hostname only, no https://). */
  link_domain: z.string().nullable().optional(),
  /** DNS: managed domain (hostname only, no https://). */
  managed_domain: z.string().nullable().optional(),
  /** DNS: managed sub-domain (reject www and @). */
  managed_sub_domain: z
    .string()
    .nullable()
    .optional()
    .refine((v) => v == null || v === '' || (v !== 'www' && v !== '@'), {
      message: 'Reserved values www and @ are not allowed',
    }),
  /** DNS: Cloudflare API key (plaintext; server encrypts before storing). Send null to clear. */
  cloudflare_api_key: z.string().nullable().optional(),
});

/** Body for POST /podcasts/import: feed URL (RSS or Atom). */
export const podcastImportBodySchema = z.object({
  feed_url: z
    .string()
    .min(1, { message: 'feed_url is required' })
    .transform((s) => s.trim())
    .refine((s) => {
      try {
        const u = new URL(s);
        return u.protocol === 'http:' || u.protocol === 'https:';
      } catch {
        return false;
      }
    }, { message: 'feed_url must be a valid http or https URL' }),
});

export type PodcastImportBody = z.infer<typeof podcastImportBodySchema>;

export type PodcastCreate = z.infer<typeof podcastCreateSchema>;
export type PodcastUpdate = z.infer<typeof podcastUpdateSchema>;

/** Body for PATCH /podcasts/:podcastId/subscriber-tokens/:id */
export const subscriberTokenUpdateSchema = z.object({
  disabled: z.boolean().optional(),
  valid_until: z.string().optional(),
  valid_from: z.string().optional(),
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
  email: z.string().email({ message: 'email is required' }),
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
    start_date: dateYYYYMMDD.optional(),
    end_date: dateYYYYMMDD.optional(),
    limit: z.coerce.number().int().min(1).optional(),
    offset: z.coerce.number().int().min(0).optional(),
  })
  .refine(
    (data) => {
      if (data.start_date != null && data.end_date != null) return data.start_date <= data.end_date;
      return true;
    },
    { message: 'start_date must be <= end_date', path: ['end_date'] }
  );

export type PodcastAnalyticsQuery = z.infer<typeof podcastAnalyticsQuerySchema>;

/** Query or body for RSS routes (public_base_url override). */
export const rssPublicBaseUrlQuerySchema = z.object({
  public_base_url: z.string().url().optional().or(z.literal('')),
}).transform((o) => ({ public_base_url: o.public_base_url?.trim() || undefined }));

export const rssPublicBaseUrlBodySchema = z.object({
  public_base_url: z.string().url().optional().or(z.literal('')),
}).transform((o) => ({ public_base_url: o.public_base_url?.trim() || undefined }));

export type PodcastCollaboratorAddBody = z.infer<typeof podcastCollaboratorAddBodySchema>;
export type PodcastCollaboratorUpdateBody = z.infer<typeof podcastCollaboratorUpdateBodySchema>;
export type RssPublicBaseUrlQuery = z.infer<typeof rssPublicBaseUrlQuerySchema>;
export type RssPublicBaseUrlBody = z.infer<typeof rssPublicBaseUrlBodySchema>;
