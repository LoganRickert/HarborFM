import { z } from 'zod';

export const episodeFileKindSchema = z.enum(['file', 'link']);

export const episodeFilesEpisodeIdParamSchema = z.object({
  id: z.string().min(1),
});

export const episodeFilesItemIdParamSchema = z.object({
  id: z.string().min(1),
  fileId: z.string().min(1),
});

export const episodeFileItemSchema = z.object({
  id: z.string(),
  episodeId: z.string(),
  kind: episodeFileKindSchema,
  title: z.string(),
  description: z.string().nullable(),
  sortOrder: z.number().int(),
  mimeType: z.string().nullable().optional(),
  byteSize: z.number().int().nullable().optional(),
  originalFilename: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  /** Public or studio download path (when applicable). */
  downloadUrl: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const episodeFilesListResponseSchema = z.object({
  items: z.array(episodeFileItemSchema),
});

export const episodeFilesCreateLinkBodySchema = z.object({
  url: z.string().url().max(2048),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
});

export const episodeFilesUpdateBodySchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  /** Only valid for link items. */
  url: z.string().url().max(2048).optional(),
});

export const episodeFilesReorderBodySchema = z.object({
  itemIds: z.array(z.string().min(1)).min(1).max(100),
});

export type EpisodeFileItem = z.infer<typeof episodeFileItemSchema>;
export type EpisodeFilesListResponse = z.infer<typeof episodeFilesListResponseSchema>;
export type EpisodeFilesCreateLinkBody = z.infer<typeof episodeFilesCreateLinkBodySchema>;
export type EpisodeFilesUpdateBody = z.infer<typeof episodeFilesUpdateBodySchema>;
export type EpisodeFilesReorderBody = z.infer<typeof episodeFilesReorderBodySchema>;
