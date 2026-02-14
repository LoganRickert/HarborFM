import { z } from 'zod';

const emptyStringToNull = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === '' ? null : v), schema);

const nullableOptionalString = emptyStringToNull(z.string().nullable().optional());

export const castRoleSchema = z.enum(['host', 'guest']);

export const castCreateSchema = z.object({
  name: z.string().min(1, { error: 'Name is required' }),
  role: castRoleSchema,
  description: nullableOptionalString,
  photo_url: emptyStringToNull(z.string().nullable().optional()),
  social_link_text: nullableOptionalString,
  is_public: z.union([z.literal(0), z.literal(1)]).default(1),
});

export const castUpdateSchema = castCreateSchema.partial();

export const castResponseSchema = z.object({
  id: z.string(),
  podcast_id: z.string(),
  name: z.string(),
  role: castRoleSchema,
  description: z.string().nullable(),
  photo_path: z.string().nullable(),
  photo_url: z.string().nullable(),
  social_link_text: z.string().nullable(),
  is_public: z.union([z.literal(0), z.literal(1)]),
  created_at: z.string(),
});

export const castListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(10),
  offset: z.coerce.number().int().min(0).optional().default(0),
  q: z.string().optional(),
  sort: z.enum(['newest', 'oldest']).optional().default('newest'),
  /** When provided, excludes cast already assigned to this episode */
  episode_id: z.string().optional().default(''),
});

export const episodeCastAssignBodySchema = z.object({
  cast_ids: z.array(z.string().min(1)).min(0),
});

export type CastRole = z.infer<typeof castRoleSchema>;
export type CastCreate = z.infer<typeof castCreateSchema>;
export type CastUpdate = z.infer<typeof castUpdateSchema>;
export type CastResponse = z.infer<typeof castResponseSchema>;
export type CastListQuery = z.infer<typeof castListQuerySchema>;
export type EpisodeCastAssignBody = z.infer<typeof episodeCastAssignBodySchema>;
