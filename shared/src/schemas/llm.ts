import { z } from 'zod';

const markerSchema = z.object({
  time: z.number(),
  title: z.string().optional(),
  color: z.string().optional(),
  markerType: z.string().optional(),
});

/** Body for POST /llm/ask (transcript + question for LLM, with optional segment context). */
export const llmAskBodySchema = z.object({
  transcript: z.string().optional(),
  question: z.string().optional(),
  segmentName: z.string().optional(),
  durationSec: z.number().optional(),
  markers: z.array(markerSchema).optional(),
});

export type LlmAskBody = z.infer<typeof llmAskBodySchema>;

/** Body for POST /llm/generate-chapters. */
export const llmGenerateChaptersBodySchema = z.object({
  transcript: z.string().min(1, { message: 'Transcript is required' }),
  durationSec: z.number().optional(),
});

export type LlmGenerateChaptersBody = z.infer<typeof llmGenerateChaptersBodySchema>;

export const llmChapterMarkerSchema = z.object({
  startSec: z.number(),
  start: z.string(),
  title: z.string(),
});

/** Response for POST /llm/generate-chapters. */
export const llmGenerateChaptersResponseSchema = z.object({
  chapters: z.array(llmChapterMarkerSchema),
});

export type LlmChapterMarker = z.infer<typeof llmChapterMarkerSchema>;
export type LlmGenerateChaptersResponse = z.infer<typeof llmGenerateChaptersResponseSchema>;

export const llmEpisodeMetadataFieldSchema = z.enum(['description', 'subtitle', 'summary']);

export type LlmEpisodeMetadataField = z.infer<typeof llmEpisodeMetadataFieldSchema>;

/** Body for POST /llm/generate-episode-field. */
export const llmGenerateEpisodeFieldBodySchema = z.object({
  transcript: z.string().min(1, { message: 'Transcript is required' }),
  field: llmEpisodeMetadataFieldSchema,
  episodeTitle: z.string().optional(),
  existingDescription: z.string().optional(),
  existingSubtitle: z.string().optional(),
  existingSummary: z.string().optional(),
});

export type LlmGenerateEpisodeFieldBody = z.infer<typeof llmGenerateEpisodeFieldBodySchema>;

/** Response for POST /llm/generate-episode-field. */
export const llmGenerateEpisodeFieldResponseSchema = z.object({
  text: z.string(),
});

export type LlmGenerateEpisodeFieldResponse = z.infer<typeof llmGenerateEpisodeFieldResponseSchema>;
