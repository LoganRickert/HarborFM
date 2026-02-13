import { z } from 'zod';

const emptyStringToNull = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === '' ? null : v), schema);

const nullableOptionalUrl = emptyStringToNull(z.string().url().nullable().optional());
const nullableOptionalString = emptyStringToNull(z.string().nullable().optional());

export const episodeTypeSchema = z.enum(['full', 'trailer', 'bonus']).nullable().optional();
export const episodeStatusSchema = z.enum(['draft', 'scheduled', 'published']);

export const episodeCreateSchema = z.object({
  title: z.string().min(1, { error: 'Title is required' }),
  description: z.string().default(''),
  subtitle: nullableOptionalString,
  summary: nullableOptionalString,
  content_encoded: nullableOptionalString,
  slug: z.string().regex(/^[a-z0-9-]+$/, { error: 'Slug: lowercase letters, numbers, hyphens only' }).optional(),
  season_number: z.number().int().min(0).nullable().optional(),
  episode_number: z.number().int().min(0).nullable().optional(),
  episode_type: episodeTypeSchema,
  explicit: z.union([z.literal(0), z.literal(1)]).nullable().optional(),
  publish_at: z.string().datetime({ offset: true }).nullable().optional(),
  status: episodeStatusSchema.default('draft'),
  artwork_url: nullableOptionalUrl,
  episode_link: nullableOptionalUrl,
  guid_is_permalink: z.union([z.literal(0), z.literal(1)]).default(0),
});

const subscriberOnlySchema = z.preprocess(
  (v) => (v === true || v === 'true' || v === 1 || v === '1' ? 1 : v === false || v === 'false' || v === 0 || v === '0' ? 0 : v),
  z.union([z.literal(0), z.literal(1)]).optional()
);

export const episodeUpdateSchema = episodeCreateSchema.partial().extend({
  slug: z.string().regex(/^[a-z0-9-]+$/, { error: 'Slug: lowercase letters, numbers, hyphens only' }).optional(),
  guid: z.string().min(1, { message: 'GUID cannot be empty' }).optional(),
  subscriber_only: subscriberOnlySchema,
});

/** Episode as returned by GET /episodes/:id and list endpoints. Includes server-computed fields. */
export const episodeResponseSchema = z.object({
  id: z.string(),
  podcast_id: z.string(),
  title: z.string(),
  slug: z.string(),
  description: z.string(),
  subtitle: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  content_encoded: z.string().nullable().optional(),
  guid: z.string(),
  season_number: z.number().int().min(0).nullable(),
  episode_number: z.number().int().min(0).nullable(),
  episode_type: episodeTypeSchema,
  explicit: z.union([z.literal(0), z.literal(1)]).nullable(),
  publish_at: z.string().nullable(),
  status: episodeStatusSchema,
  artwork_path: z.string().nullable(),
  artwork_url: z.string().nullable(),
  artwork_filename: z.string().nullable().optional(),
  audio_source_path: z.string().nullable(),
  audio_final_path: z.string().nullable(),
  audio_mime: z.string().nullable(),
  audio_bytes: z.number().nullable(),
  audio_duration_sec: z.number().nullable(),
  episode_link: z.string().nullable(),
  guid_is_permalink: z.union([z.literal(0), z.literal(1)]),
  created_at: z.string(),
  updated_at: z.string(),
  /** True when the episode has final audio and a transcript.srt file exists. */
  has_transcript: z.boolean().optional(),
  /** 1 = omitted from public RSS and episode list; only in tokenized subscriber feed. */
  subscriber_only: z.union([z.literal(0), z.literal(1)]).optional(),
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
