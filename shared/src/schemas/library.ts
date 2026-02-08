import { z } from 'zod';

export const libraryAssetSchema = z.object({
  id: z.string(),
  owner_user_id: z.string().optional(),
  name: z.string(),
  tag: z.string().nullable(),
  duration_sec: z.number(),
  created_at: z.string(),
  global_asset: z.union([z.literal(0), z.literal(1), z.boolean()]).optional(),
});

export const libraryUpdateSchema = z.object({
  name: z.string().min(1, { message: 'Name is required' }).optional(),
  tag: z.string().nullable().optional(),
  global_asset: z.boolean().optional(),
});

export type LibraryAsset = z.infer<typeof libraryAssetSchema>;
export type LibraryUpdate = z.infer<typeof libraryUpdateSchema>;
