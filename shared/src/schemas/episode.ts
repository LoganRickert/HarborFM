import { z } from 'zod';

const emptyStringToNull = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === '' ? null : v), schema);

const nullableOptionalUrl = emptyStringToNull(z.string().url().nullable().optional());

export const episodeTypeSchema = z.enum(['full', 'trailer', 'bonus']).nullable().optional();
export const episodeStatusSchema = z.enum(['draft', 'scheduled', 'published']);

export const episodeCreateSchema = z.object({
  title: z.string().min(1, { message: 'Title is required' }),
  description: z.string().default(''),
  slug: z.string().regex(/^[a-z0-9-]+$/, { message: 'Slug: lowercase letters, numbers, hyphens only' }).optional(),
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

export const episodeUpdateSchema = episodeCreateSchema.partial().extend({
  slug: z.string().regex(/^[a-z0-9-]+$/, { message: 'Slug: lowercase letters, numbers, hyphens only' }).optional(),
});

export type EpisodeCreate = z.infer<typeof episodeCreateSchema>;
export type EpisodeUpdate = z.infer<typeof episodeUpdateSchema>;
export type EpisodeStatus = z.infer<typeof episodeStatusSchema>;
export type EpisodeType = z.infer<typeof episodeTypeSchema>;
