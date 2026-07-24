import { api, apiGet } from './client';
import type {
  LlmEpisodeMetadataField,
  LlmGenerateChaptersResponse,
  LlmGenerateEpisodeFieldResponse,
} from '@harborfm/shared';

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

export type GenerateEpisodeFieldContext = {
  episodeTitle?: string;
  existingDescription?: string;
  existingSubtitle?: string;
  existingSummary?: string;
};

export function generateEpisodeField(
  transcript: string,
  field: LlmEpisodeMetadataField,
  context?: GenerateEpisodeFieldContext,
): Promise<LlmGenerateEpisodeFieldResponse> {
  return api<LlmGenerateEpisodeFieldResponse>('/llm/generate-episode-field', {
    method: 'POST',
    json: {
      transcript,
      field,
      episodeTitle: context?.episodeTitle,
      existingDescription: context?.existingDescription,
      existingSubtitle: context?.existingSubtitle,
      existingSummary: context?.existingSummary,
    },
  });
}
