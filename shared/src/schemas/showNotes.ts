import { z } from 'zod';

export const SHOW_NOTES_DURATION_OPTIONS = [5, 10, 15, 20, 25, 30] as const;

export const showNotesDurationMinSchema = z.union([
  z.literal(5),
  z.literal(10),
  z.literal(15),
  z.literal(20),
  z.literal(25),
  z.literal(30),
]);

export const showNotesEpisodeIdParamSchema = z.object({
  id: z.string().min(1),
});

export const showNotesItemIdParamSchema = z.object({
  id: z.string().min(1),
  itemId: z.string().min(1),
});

export const showNotesItemSchema = z.object({
  id: z.string(),
  text: z.string().max(500),
  durationMin: showNotesDurationMinSchema.nullable().optional(),
  checked: z.boolean(),
  position: z.number().int(),
});

export const showNotesListResponseSchema = z.object({
  guestVisible: z.boolean(),
  items: z.array(showNotesItemSchema),
});

export const showNotesPatchBodySchema = z.object({
  guestVisible: z.boolean(),
});

export const showNotesCreateItemBodySchema = z.object({
  text: z.string().max(500).optional().default(''),
});

export const showNotesUpdateItemBodySchema = z.object({
  text: z.string().max(500).optional(),
  durationMin: showNotesDurationMinSchema.nullable().optional(),
  checked: z.boolean().optional(),
});

export const showNotesReorderBodySchema = z.object({
  itemIds: z.array(z.string().min(1)).min(1),
});

export type ShowNotesDurationMin = z.infer<typeof showNotesDurationMinSchema>;
export type ShowNotesItem = z.infer<typeof showNotesItemSchema>;
export type ShowNotesListResponse = z.infer<typeof showNotesListResponseSchema>;
export type ShowNotesPatchBody = z.infer<typeof showNotesPatchBodySchema>;
export type ShowNotesCreateItemBody = z.infer<typeof showNotesCreateItemBodySchema>;
export type ShowNotesUpdateItemBody = z.infer<typeof showNotesUpdateItemBodySchema>;
export type ShowNotesReorderBody = z.infer<typeof showNotesReorderBodySchema>;
