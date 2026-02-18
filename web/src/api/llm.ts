import { api, apiGet } from './client';

export function getLlmAvailable(): Promise<{ available: boolean }> {
  return apiGet<{ available: boolean }>('/llm/available');
}

export type AskLlmContext = {
  segmentName?: string;
  durationSec?: number;
  markers?: Array<{ time: number; title?: string; color?: string; marker_type?: string }>;
};

export function askLlm(
  transcript: string,
  question: string,
  context?: AskLlmContext
): Promise<{ response: string }> {
  return api<{ response: string }>('/llm/ask', {
    method: 'POST',
    json: {
      transcript,
      question,
      segment_name: context?.segmentName,
      duration_sec: context?.durationSec,
      markers: context?.markers,
    },
  });
}
