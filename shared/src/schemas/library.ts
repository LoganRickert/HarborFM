import { z } from 'zod';

export const libraryAssetSchema = z.object({
  id: z.string(),
  ownerUserId: z.string().optional(),
  name: z.string(),
  tag: z.string().nullable(),
  durationSec: z.number(),
  createdAt: z.string(),
  globalAsset: z.union([z.literal(0), z.literal(1), z.boolean()]).optional(),
  copyright: z.string().nullable().optional(),
  license: z.string().nullable().optional(),
});

export const libraryUpdateSchema = z.object({
  name: z.string().min(1, { error: 'Name is required' }).optional(),
  tag: z.string().nullable().optional(),
  globalAsset: z.boolean().optional(),
  copyright: z.string().nullable().optional(),
  license: z.string().nullable().optional(),
});

/** Body for POST /library/add-by-url (add asset from URL). */
export const libraryAddByUrlBodySchema = z.object({
  url: z.string().min(1, { message: 'URL is required' }).transform((s) => s.trim()).pipe(z.string().url()),
});

export type LibraryAsset = z.infer<typeof libraryAssetSchema>;
export type LibraryUpdate = z.infer<typeof libraryUpdateSchema>;
export type LibraryAddByUrlBody = z.infer<typeof libraryAddByUrlBodySchema>;
