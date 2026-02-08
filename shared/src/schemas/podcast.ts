import { z } from 'zod';

const emptyStringToNull = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === '' ? null : v), schema);

const nullableOptionalString = emptyStringToNull(z.string().nullable().optional());
const nullableOptionalUrl = emptyStringToNull(z.string().url().nullable().optional());
const nullableOptionalUuid = emptyStringToNull(z.string().uuid().nullable().optional());

export const podcastCreateSchema = z.object({
  title: z.string().min(1, { message: 'Title is required' }),
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/, { message: 'Slug: lowercase letters, numbers, hyphens only' }),
  description: z.string().default(''),
  language: z.string().length(2).default('en'),
  author_name: z.string().default(''),
  owner_name: z.string().default(''),
  email: z.string().email().optional().or(z.literal('')),
  category_primary: z.string().default(''),
  category_secondary: nullableOptionalString,
  category_tertiary: nullableOptionalString,
  explicit: z.union([z.literal(0), z.literal(1)]).default(0),
  site_url: nullableOptionalUrl,
  // allow any string here (some users paste non-standard URLs); normalize '' -> null
  artwork_url: emptyStringToNull(z.string().nullable().optional()),
  copyright: nullableOptionalString,
  podcast_guid: nullableOptionalUuid,
  locked: z.union([z.literal(0), z.literal(1)]).default(0),
  license: nullableOptionalString,
  itunes_type: z.enum(['episodic', 'serial']).default('episodic'),
  medium: z.enum(['podcast', 'music', 'video', 'film', 'audiobook', 'newsletter', 'blog']).default('podcast'),
});

export const podcastUpdateSchema = podcastCreateSchema.partial();

export type PodcastCreate = z.infer<typeof podcastCreateSchema>;
export type PodcastUpdate = z.infer<typeof podcastUpdateSchema>;
