import { z } from 'zod';

const emptyStringToNull = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === '' ? null : v), schema);

const nullableOptionalUrl = emptyStringToNull(z.string().url().nullable().optional());
const nullableOptionalString = emptyStringToNull(z.string().nullable().optional());

export const episodeTypeSchema = z.enum(['full', 'trailer', 'bonus']).nullable().optional();
export const episodeStatusSchema = z.enum(['draft', 'scheduled', 'published']);

export const episodeCreateSchema = z.object({
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
  status: episodeStatusSchema.default('draft'),
  artworkUrl: nullableOptionalUrl,
  episodeLink: nullableOptionalUrl,
  guidIsPermalink: z.union([z.literal(0), z.literal(1)]).default(0),
});

const subscriberOnlySchema = z.preprocess(
  (v) => (v === true || v === 'true' || v === 1 || v === '1' ? 1 : v === false || v === 'false' || v === 0 || v === '0' ? 0 : v),
  z.union([z.literal(0), z.literal(1)]).optional()
);

const finalMarkerSchema = z.object({
  time: z.number(),
  title: z.string().optional(),
  color: z.string().optional(),
});

export const episodeUpdateSchema = episodeCreateSchema.partial().extend({
  slug: z.string().regex(/^[a-z0-9-]+$/, { error: 'Slug: lowercase letters, numbers, hyphens only' }).optional(),
  guid: z.string().min(1, { message: 'GUID cannot be empty' }).optional(),
  subscriberOnly: subscriberOnlySchema,
  /** Chapter markers for the final audio. Overwrites markers from render. */
  finalMarkers: z.array(finalMarkerSchema).optional().nullable(),
});

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
  /** Chapter markers from segments (marker_type === 'chapter'); time in seconds of final audio. */
  finalMarkers: z.array(z.object({ time: z.number(), title: z.string().optional(), color: z.string().optional() })).optional().nullable(),
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
