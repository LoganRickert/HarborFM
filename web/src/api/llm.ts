import { api, apiGet } from './client';
import type { LlmGenerateChaptersResponse } from '@harborfm/shared';

export function getLlmAvailable(): Promise<{ available: boolean }> {
  return apiGet<{ available: boolean }>('/llm/available');
}

export type AskLlmContext = {
  segmentName?: string;
  durationSec?: number;
  markers?: Array<{ time: number; title?: string; color?: string; markerType?: string }>;
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
      segmentName: context?.segmentName,
      durationSec: context?.durationSec,
      markers: context?.markers,
    },
  });
}

export function generateChapterMarkers(
  transcript: string,
  durationSec?: number,
): Promise<LlmGenerateChaptersResponse> {
  return api<LlmGenerateChaptersResponse>('/llm/generate-chapters', {
    method: 'POST',
    json: {
      transcript,
      durationSec,
    },
  });
}
