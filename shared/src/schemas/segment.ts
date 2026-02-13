import { z } from 'zod';

/** Params for routes using episode id as :id (e.g. GET/POST /episodes/:id/segments, PUT reorder, GET render-status, POST render). */
export const segmentEpisodeIdParamSchema = z.object({
  id: z.string().min(1),
});

/** Params for routes using :episodeId and :segmentId. */
export const segmentEpisodeSegmentIdParamSchema = z.object({
  episodeId: z.string().min(1),
  segmentId: z.string().min(1),
});

/** Params for routes using only :episodeId (e.g. GET/PATCH transcript, GET transcript-status, POST generate-transcript). */
export const segmentEpisodeIdOnlyParamSchema = z.object({
  episodeId: z.string().min(1),
});

/** JSON body for POST /episodes/:id/segments when adding a reusable segment. */
export const segmentCreateReusableBodySchema = z.object({
  type: z.literal('reusable'),
  reusable_asset_id: z.string().min(1, { message: 'reusable_asset_id is required' }),
  name: z.string().optional(),
});

/** Body for PUT /episodes/:id/segments/reorder. */
export const segmentReorderBodySchema = z.object({
  segment_ids: z.array(z.string().min(1), { message: 'segment_ids must be a non-empty array' }).min(1, { message: 'segment_ids array required' }),
});

/** Body for PATCH /episodes/:episodeId/segments/:segmentId (update name). */
export const segmentUpdateNameBodySchema = z.object({
  name: z.union([z.string(), z.null()]),
});

/** Body for POST /episodes/:episodeId/segments/:segmentId/trim. */
export const segmentTrimBodySchema = z
  .object({
    start_sec: z.number().optional(),
    end_sec: z.number().optional(),
  })
  .refine((data) => data.start_sec !== undefined || data.end_sec !== undefined, {
    message: 'Either start_sec or end_sec must be provided',
  });

/** Body for POST /episodes/:episodeId/segments/:segmentId/remove-silence. */
export const segmentRemoveSilenceBodySchema = z.object({
  threshold_seconds: z.number().positive().optional(),
  silence_threshold: z.number().optional(),
});

/** Body for POST /episodes/:episodeId/segments/:segmentId/noise-suppression. */
export const segmentNoiseSuppressionBodySchema = z.object({
  nf: z.number().finite().optional(),
});

/** Body for PATCH /episodes/:episodeId/segments/:segmentId/transcript. */
export const segmentTranscriptBodySchema = z.object({
  text: z.string().min(1, { message: 'Transcript text is required' }),
});

/** Body for PATCH /episodes/:episodeId/transcript. */
export const segmentEpisodeTranscriptBodySchema = z.object({
  text: z.string().min(1, { message: 'Transcript text is required' }),
});

/** Query for POST /episodes/:episodeId/segments/:segmentId/transcript (generate). */
export const segmentTranscriptGenerateQuerySchema = z.object({
  regenerate: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

/** Query for DELETE /episodes/:episodeId/segments/:segmentId/transcript. */
export const segmentTranscriptDeleteQuerySchema = z.object({
  entryIndex: z.optional(z.coerce.number().int()),
});

/** Single segment as returned by list/update/create (DB row; list includes asset_name from JOIN). */
export const segmentResponseSchema = z.object({
  id: z.string(),
  episode_id: z.string(),
  position: z.number(),
  type: z.enum(['recorded', 'reusable']),
  name: z.string().nullable().optional(),
  reusable_asset_id: z.string().nullable().optional(),
  asset_name: z.string().nullable().optional(),
  audio_path: z.string().nullable().optional(),
  duration_sec: z.number(),
  created_at: z.string(),
});

/** Response for GET /episodes/:id/segments and PUT reorder. */
export const segmentsListResponseSchema = z.object({
  segments: z.array(segmentResponseSchema),
});

/** Response for GET segment transcript, PATCH segment transcript, GET/PATCH episode transcript. */
export const transcriptTextResponseSchema = z.object({
  text: z.string(),
});

/** Response for GET /episodes/:episodeId/transcript-status. */
export const transcriptStatusResponseSchema = z.object({
  status: z.enum(['idle', 'transcribing', 'done', 'failed']),
  error: z.string().optional(),
});

/** Response for GET /episodes/:id/render-status. */
export const renderStatusResponseSchema = z.object({
  status: z.enum(['idle', 'building', 'done', 'failed']),
  error: z.string().optional(),
});

export type SegmentEpisodeIdParam = z.infer<typeof segmentEpisodeIdParamSchema>;
export type SegmentEpisodeSegmentIdParam = z.infer<typeof segmentEpisodeSegmentIdParamSchema>;
export type SegmentEpisodeIdOnlyParam = z.infer<typeof segmentEpisodeIdOnlyParamSchema>;
export type SegmentCreateReusableBody = z.infer<typeof segmentCreateReusableBodySchema>;
export type SegmentReorderBody = z.infer<typeof segmentReorderBodySchema>;
export type SegmentUpdateNameBody = z.infer<typeof segmentUpdateNameBodySchema>;
export type SegmentTrimBody = z.infer<typeof segmentTrimBodySchema>;
export type SegmentRemoveSilenceBody = z.infer<typeof segmentRemoveSilenceBodySchema>;
export type SegmentNoiseSuppressionBody = z.infer<typeof segmentNoiseSuppressionBodySchema>;
export type SegmentTranscriptBody = z.infer<typeof segmentTranscriptBodySchema>;
export type SegmentEpisodeTranscriptBody = z.infer<typeof segmentEpisodeTranscriptBodySchema>;
export type SegmentTranscriptGenerateQuery = z.infer<typeof segmentTranscriptGenerateQuerySchema>;
export type SegmentTranscriptDeleteQuery = z.infer<typeof segmentTranscriptDeleteQuerySchema>;
export type SegmentResponse = z.infer<typeof segmentResponseSchema>;
export type SegmentsListResponse = z.infer<typeof segmentsListResponseSchema>;
export type TranscriptTextResponse = z.infer<typeof transcriptTextResponseSchema>;
export type TranscriptStatusResponse = z.infer<typeof transcriptStatusResponseSchema>;
export type RenderStatusResponse = z.infer<typeof renderStatusResponseSchema>;
