import { z } from 'zod';

export const SHOW_NOTES_DURATION_OPTIONS = [5, 10, 15, 20, 25, 30] as const;

export const SHOW_NOTES_TAG_OPTIONS = ['none', 'discuss', 'avoid'] as const;

export const SHOW_NOTES_TAG_LABELS: Record<(typeof SHOW_NOTES_TAG_OPTIONS)[number], string> = {
  none: 'None',
  discuss: 'Topic To Discuss',
  avoid: 'Topic To Avoid',
};

export const showNotesDurationMinSchema = z.union([
  z.literal(5),
  z.literal(10),
  z.literal(15),
  z.literal(20),
  z.literal(25),
  z.literal(30),
]);

export const showNotesTagSchema = z.enum(SHOW_NOTES_TAG_OPTIONS);

/** Guest-submitted tags only (not run-of-show notes). */
export const showNotesGuestTagSchema = z.enum(['discuss', 'avoid']);

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
  tag: showNotesTagSchema,
  submittedBy: z.string().max(320).nullable(),
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
  tag: showNotesTagSchema.optional().default('none'),
  submittedBy: z.string().max(320).nullable().optional(),
});

export const showNotesUpdateItemBodySchema = z.object({
  text: z.string().max(500).optional(),
  durationMin: showNotesDurationMinSchema.nullable().optional(),
  checked: z.boolean().optional(),
  tag: showNotesTagSchema.optional(),
  submittedBy: z.string().max(320).nullable().optional(),
});

export const showNotesReorderBodySchema = z.object({
  itemIds: z.array(z.string().min(1)).min(1),
});

/** Public guest topics: meeting token param. */
export const meetingTopicsTokenParamSchema = z.object({
  token: z.string().min(1),
});

export const meetingTopicsItemIdParamSchema = z.object({
  token: z.string().min(1),
  itemId: z.string().min(1),
});

/** Identity: invite token and/or submittedBy name. */
export const meetingTopicsIdentitySchema = z.object({
  invite: z.string().min(1).optional(),
  submittedBy: z.string().min(1).max(320).optional(),
});

export const meetingTopicsCreateBodySchema = z.object({
  text: z.string().max(500).optional().default(''),
  tag: showNotesGuestTagSchema,
  invite: z.string().min(1).optional(),
  submittedBy: z.string().min(1).max(320).optional(),
});

export const meetingTopicsUpdateBodySchema = z.object({
  text: z.string().max(500).optional(),
  tag: showNotesGuestTagSchema.optional(),
  invite: z.string().min(1).optional(),
  submittedBy: z.string().min(1).max(320).optional(),
});

export const meetingTopicsReorderBodySchema = z.object({
  itemIds: z.array(z.string().min(1)).min(1),
  invite: z.string().min(1).optional(),
  submittedBy: z.string().min(1).max(320).optional(),
});

export const meetingTopicsGuestItemSchema = z.object({
  id: z.string(),
  text: z.string().max(500),
  /** Original guest intent; promoted-to-notes items keep discuss for display. */
  tag: showNotesGuestTagSchema,
  submittedBy: z.string().max(320),
  position: z.number().int(),
  /** True when the host promoted this suggestion into run-of-show Notes. */
  addedToNotes: z.boolean(),
});

export type ShowNotesDurationMin = z.infer<typeof showNotesDurationMinSchema>;
export type ShowNotesTag = z.infer<typeof showNotesTagSchema>;
export type ShowNotesGuestTag = z.infer<typeof showNotesGuestTagSchema>;
export type ShowNotesItem = z.infer<typeof showNotesItemSchema>;
export type ShowNotesListResponse = z.infer<typeof showNotesListResponseSchema>;
export type ShowNotesPatchBody = z.infer<typeof showNotesPatchBodySchema>;
export type ShowNotesCreateItemBody = z.infer<typeof showNotesCreateItemBodySchema>;
export type ShowNotesUpdateItemBody = z.infer<typeof showNotesUpdateItemBodySchema>;
export type ShowNotesReorderBody = z.infer<typeof showNotesReorderBodySchema>;
export type MeetingTopicsCreateBody = z.infer<typeof meetingTopicsCreateBodySchema>;
export type MeetingTopicsUpdateBody = z.infer<typeof meetingTopicsUpdateBodySchema>;
export type MeetingTopicsReorderBody = z.infer<typeof meetingTopicsReorderBodySchema>;
export type MeetingTopicsGuestItem = z.infer<typeof meetingTopicsGuestItemSchema>;
