import { z } from 'zod';
import {
  CAST_SOCIAL_LINKS_MAX,
  normalizeCastSocialLinks,
} from '../castSocialLinks.js';

const emptyStringToNull = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === '' ? null : v), schema);

const nullableOptionalString = emptyStringToNull(z.string().nullable().optional());

export const castRoleSchema = z.enum(['host', 'guest']);

/** Validates and normalizes a socialLinks array (required present). */
const socialLinksArraySchema = z
  .array(z.string())
  .max(CAST_SOCIAL_LINKS_MAX)
  .transform((arr) => normalizeCastSocialLinks(arr))
  .pipe(
    z
      .array(
        z
          .string()
          .url({ error: 'Enter a valid URL (https://...)' })
          .max(2000),
      )
      .max(CAST_SOCIAL_LINKS_MAX),
  );

export const castCreateSchema = z.object({
  name: z.string().min(1, { error: 'Name is required' }),
  role: castRoleSchema,
  description: nullableOptionalString,
  photoUrl: emptyStringToNull(z.string().nullable().optional()),
  socialLinks: z.preprocess(
    (v) => (v === undefined || v === null ? [] : v),
    socialLinksArraySchema,
  ),
  /** Private invite email; backend only, not shown on public feeds. */
  email: emptyStringToNull(
    z
      .string()
      .email({ error: 'Enter a valid email' })
      .nullable()
      .optional(),
  ),
  isPublic: z.union([z.literal(0), z.literal(1)]).default(1),
});

/**
 * Partial update schema. Do not use castCreateSchema.partial() alone: Zod 4 still
 * applies .default() for omitted keys (isPublic: 1), which can flip private cast public.
 */
export const castUpdateSchema = castCreateSchema
  .omit({ isPublic: true, socialLinks: true })
  .partial()
  .extend({
    isPublic: z.union([z.literal(0), z.literal(1)]).optional(),
    /** Omitted = leave unchanged; present (including []) = replace. */
    socialLinks: socialLinksArraySchema.optional(),
  });

export const castResponseSchema = z.object({
  id: z.string(),
  podcastId: z.string(),
  name: z.string(),
  role: castRoleSchema,
  description: z.string().nullable(),
  photoPath: z.string().nullable(),
  photoUrl: z.string().nullable(),
  socialLinks: z.array(z.string()),
  email: z.string().nullable(),
  isPublic: z.union([z.literal(0), z.literal(1)]),
  createdAt: z.string(),
});

export const castListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(10),
  offset: z.coerce.number().int().min(0).optional().default(0),
  q: z.string().optional(),
  sort: z.enum(['newest', 'oldest']).optional().default('newest'),
  /** When provided, excludes cast already assigned to this episode */
  episodeId: z.string().optional().default(''),
});

export const episodeCastAssignBodySchema = z.object({
  castIds: z.array(z.string().min(1)).min(0),
});

export type CastRole = z.infer<typeof castRoleSchema>;
export type CastCreate = z.infer<typeof castCreateSchema>;
export type CastUpdate = z.infer<typeof castUpdateSchema>;
export type CastResponse = z.infer<typeof castResponseSchema>;
export type CastListQuery = z.infer<typeof castListQuerySchema>;
export type EpisodeCastAssignBody = z.infer<typeof episodeCastAssignBodySchema>;
