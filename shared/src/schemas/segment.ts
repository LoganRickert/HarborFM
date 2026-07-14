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

/** Body for POST /episodes/:episodeId/segments/waveforms-bulk. Max 10 segment IDs. */
export const segmentWaveformsBulkBodySchema = z.object({
  segmentIds: z
    .array(z.string().min(1))
    .min(1, { message: 'segmentIds required' })
    .max(10, { message: 'max 10 segmentIds' }),
});

/** Body for POST /episodes/:episodeId/segments/waveforms-bulk (snake_case request key). */
export const segmentWaveformsBulkBodySnakeSchema = z.object({
  segment_ids: z
    .array(z.string().min(1))
    .min(1, { message: 'segment_ids required' })
    .max(10, { message: 'max 10 segment_ids' }),
});

/** JSON body for POST /episodes/:id/segments when adding a reusable segment. */
export const segmentCreateReusableBodySchema = z.object({
  type: z.literal('reusable'),
  reusableAssetId: z.string().min(1, { message: 'reusableAssetId is required' }),
  name: z.string().optional(),
});

/** Body for PUT /episodes/:id/segments/reorder. */
export const segmentReorderBodySchema = z.object({
  segmentIds: z.array(z.string().min(1), { message: 'segmentIds must be a non-empty array' }).min(1, { message: 'segmentIds array required' }),
});

/** Trim range: [start, end] in absolute seconds (2 decimal places). */
export const trimRangeSchema = z.tuple([
  z.number().min(0),
  z.number().min(0),
]).refine(([start, end]) => start < end, { message: 'start must be less than end' });

/** Array of trim ranges (excluded sections). Non-overlapping, sorted. */
export const trimRangesSchema = z.array(trimRangeSchema);

/** Single marker: point in time with optional title, color (hex), and markerType. */
export const markerSchema = z
  .object({
    time: z.number().min(0),
    title: z.string().optional(),
    color: z.string().optional(),
    /** '' | undefined = None, 'chapter' = Chapter, 'soundbite' = Soundbite */
    markerType: z.union([z.literal(''), z.literal('chapter'), z.literal('soundbite')]).optional(),
    /** Duration in seconds when markerType is soundbite (15–120). */
    duration: z.number().min(15).max(120).optional(),
  })
  .refine(
    (m) => m.markerType !== 'soundbite' || (typeof m.duration === 'number' && m.duration >= 15 && m.duration <= 120),
    { message: 'Soundbite markers require duration between 15 and 120 seconds', path: ['duration'] },
  );

/** Array of markers. */
export const markersSchema = z.array(markerSchema);

/** Optional 3-band EQ gains in dB (-20..+20). Stored per segment; applied at render. */
export const audioEqSchema = z
  .object({
    lowDb: z.number().min(-20).max(20).optional(),
    midDb: z.number().min(-20).max(20).optional(),
    highDb: z.number().min(-20).max(20).optional(),
  })
  .optional()
  .nullable();

/** Marker type for use in TS  */
export interface Marker {
  time: number;
  title?: string;
  color?: string;
  markerType?: '' | 'chapter' | 'soundbite';
  /** Duration in seconds when markerType is soundbite (15–120). */
  duration?: number;
}

/** Default duration (seconds) when creating a soundbite marker. */
export const SOUNDBITE_DEFAULT_DURATION = 30;

/** Body for PATCH /episodes/:episodeId/segments/:segmentId (update name, trim_ranges, markers). */
export const segmentUpdateNameBodySchema = z.object({
  name: z.union([z.string(), z.null()]).optional(),
});

/** Body for PATCH /episodes/:episodeId/segments/:segmentId (full update). */
export const segmentUpdateBodySchema = z.object({
  name: z.union([z.string(), z.null()]).optional(),
  trimRanges: trimRangesSchema.optional().nullable(),
  markers: markersSchema.optional().nullable(),
  audioEq: audioEqSchema,
  disabled: z.boolean().optional(),
});

/** Body for POST /episodes/:episodeId/segments/:segmentId/trim. */
export const segmentTrimBodySchema = z
  .object({
    startSec: z.number().optional(),
    endSec: z.number().optional(),
  })
  .refine((data) => data.startSec !== undefined || data.endSec !== undefined, {
    message: 'Either startSec or endSec must be provided',
  });

/** Body for POST /episodes/:episodeId/segments/:segmentId/remove-silence. */
export const segmentRemoveSilenceBodySchema = z.object({
  thresholdSeconds: z.number().positive().optional(),
  silenceThreshold: z.number().optional(),
});

/** Body for POST /episodes/:episodeId/segments/:segmentId/noise-suppression. */
export const segmentNoiseSuppressionBodySchema = z.object({
  nf: z.number().finite().optional(),
});

/** Body for POST /episodes/:episodeId/segments/:segmentId/split. */
export const segmentSplitBodySchema = z.object({
  minutes: z.number().int().min(0),
  /** Fractional seconds allowed (0 <= seconds < 60). */
  seconds: z.number().min(0).lt(60),
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

/** Single segment as returned by list/update/create (DB row; list includes assetName from JOIN). */
export const segmentResponseSchema = z.object({
  id: z.string(),
  episodeId: z.string(),
  position: z.number(),
  type: z.enum(['recorded', 'reusable']),
  name: z.string().nullable().optional(),
  reusableAssetId: z.string().nullable().optional(),
  assetName: z.string().nullable().optional(),
  audioPath: z.string().nullable().optional(),
  durationSec: z.number(),
  createdAt: z.string(),
  /** True when waveform file exists on disk; client can skip fetch when false. */
  waveformExists: z.boolean().optional(),
  /** True when recording is in progress (placeholder, awaiting webrtc callback). */
  inProgress: z.boolean().optional(),
  /** True when recording failed (ffmpeg error, server crash, etc). */
  recordFailed: z.boolean().optional(),
  /** Excluded ranges [[start, end], ...] in absolute seconds. */
  trimRanges: z.array(z.tuple([z.number(), z.number()])).optional().nullable(),
  /** Markers [{time, title?, color?}, ...]. */
  markers: markersSchema.optional().nullable(),
  /** Optional 3-band EQ (low/mids/high) in dB; applied at render. */
  audioEq: audioEqSchema,
  /** When true, segment is excluded from the final generated episode. */
  disabled: z.boolean().optional(),
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

/** Spectrum style for video generation (showspectrum color schemes). */
export const videoSpectrumStyleSchema = z.enum(['spectrum-rainbow', 'spectrum-magma', 'spectrum-viridis']);
export type VideoSpectrumStyle = z.infer<typeof videoSpectrumStyleSchema>;

/** Resolution for video generation. */
export const videoResolutionSchema = z.enum(['480p', '720p', '1080p']);
export type VideoResolution = z.infer<typeof videoResolutionSchema>;

/** Orientation for video generation. */
export const videoOrientationSchema = z.enum(['landscape', 'portrait']);
export type VideoOrientation = z.infer<typeof videoOrientationSchema>;

/** Waveform visualization type. */
export const videoWaveformTypeSchema = z.enum(['sine', 'bars', 'circle', 'dots']);
export type VideoWaveformType = z.infer<typeof videoWaveformTypeSchema>;

/** JSON body for POST /episodes/:id/generate-video (x, y 0–1 relative, width, amplitude, style). Image is optional multipart. */
export const generateVideoBodySchema = z.object({
  /** X position of waveform overlay, 0–1 (0=left, 0.5=center, 1=right). */
  x: z.coerce.number().min(0).max(1),
  /** Y position of waveform overlay, 0–1 (0=top, 0.5=center, 1=bottom). */
  y: z.coerce.number().min(0).max(1),
  /** Width of waveform overlay, 0–1 (fraction of video width). Mapped to pixels in generateEpisodeVideo. */
  width: z.coerce.number().min(0).max(1),
  amplitude: z.coerce.number().min(0).max(2),
  style: videoSpectrumStyleSchema.optional(),
  /** Integer 1–30: for sine/circle = stroke width (px); for bars/dots = bar/dot count. Optional; default 3. */
  strokeWidth: z.coerce.number().int().min(1).max(30).optional(),
  /** Smoothing 0–1 (0=instant, 1=very smooth). Optional; default 0.7. */
  smoothing: z.coerce.number().min(0).max(1).optional(),
  /** Output resolution. Optional; default 720p. */
  resolution: videoResolutionSchema.optional(),
  /** Output orientation. Optional; default landscape. */
  orientation: videoOrientationSchema.optional(),
  /** Waveform type (sine, bars, circle, dots). Optional; default sine. */
  waveformType: videoWaveformTypeSchema.optional(),
  /** Waveform color: any CSS color (hex, rgb, rgba, or gradient). Optional; overrides style when set. Max length 100. */
  color: z.string().max(100).optional(),
});

/** Response for GET /episodes/:id/video-status. */
export const videoStatusResponseSchema = z.object({
  status: z.enum(['idle', 'generating', 'done', 'failed']),
  error: z.string().optional(),
});

export type SegmentEpisodeIdParam = z.infer<typeof segmentEpisodeIdParamSchema>;
export type SegmentEpisodeSegmentIdParam = z.infer<typeof segmentEpisodeSegmentIdParamSchema>;
export type SegmentEpisodeIdOnlyParam = z.infer<typeof segmentEpisodeIdOnlyParamSchema>;
export type SegmentCreateReusableBody = z.infer<typeof segmentCreateReusableBodySchema>;
export type SegmentReorderBody = z.infer<typeof segmentReorderBodySchema>;
export type SegmentUpdateNameBody = z.infer<typeof segmentUpdateNameBodySchema>;
export type AudioEq = z.infer<typeof audioEqSchema>;
export type SegmentUpdateBody = z.infer<typeof segmentUpdateBodySchema>;
export type TrimRange = z.infer<typeof trimRangeSchema>;
export type SegmentTrimBody = z.infer<typeof segmentTrimBodySchema>;
export type SegmentRemoveSilenceBody = z.infer<typeof segmentRemoveSilenceBodySchema>;
export type SegmentNoiseSuppressionBody = z.infer<typeof segmentNoiseSuppressionBodySchema>;
export type SegmentSplitBody = z.infer<typeof segmentSplitBodySchema>;
export type SegmentTranscriptBody = z.infer<typeof segmentTranscriptBodySchema>;
export type SegmentEpisodeTranscriptBody = z.infer<typeof segmentEpisodeTranscriptBodySchema>;
export type SegmentTranscriptGenerateQuery = z.infer<typeof segmentTranscriptGenerateQuerySchema>;
export type SegmentTranscriptDeleteQuery = z.infer<typeof segmentTranscriptDeleteQuerySchema>;
export type SegmentResponse = z.infer<typeof segmentResponseSchema>;
export type SegmentsListResponse = z.infer<typeof segmentsListResponseSchema>;
export type TranscriptTextResponse = z.infer<typeof transcriptTextResponseSchema>;
export type TranscriptStatusResponse = z.infer<typeof transcriptStatusResponseSchema>;
export type RenderStatusResponse = z.infer<typeof renderStatusResponseSchema>;
export type GenerateVideoBody = z.infer<typeof generateVideoBodySchema>;
export type VideoStatusResponse = z.infer<typeof videoStatusResponseSchema>;
