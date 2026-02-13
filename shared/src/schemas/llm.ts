import { z } from 'zod';

/** Body for POST /llm/ask (transcript + question for LLM). */
export const llmAskBodySchema = z.object({
  transcript: z.string().optional(),
  question: z.string().optional(),
});

export type LlmAskBody = z.infer<typeof llmAskBodySchema>;
