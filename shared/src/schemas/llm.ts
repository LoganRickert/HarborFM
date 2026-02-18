import { z } from 'zod';

const markerSchema = z.object({
  time: z.number(),
  title: z.string().optional(),
  color: z.string().optional(),
  marker_type: z.string().optional(),
});

/** Body for POST /llm/ask (transcript + question for LLM, with optional segment context). */
export const llmAskBodySchema = z.object({
  transcript: z.string().optional(),
  question: z.string().optional(),
  segment_name: z.string().optional(),
  duration_sec: z.number().optional(),
  markers: z.array(markerSchema).optional(),
});

export type LlmAskBody = z.infer<typeof llmAskBodySchema>;
