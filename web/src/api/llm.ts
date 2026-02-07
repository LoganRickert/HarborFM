import { api, apiGet } from './client';

export function getLlmAvailable(): Promise<{ available: boolean }> {
  return apiGet<{ available: boolean }>('/llm/available');
}

export function askLlm(transcript: string, question: string): Promise<{ response: string }> {
  return api<{ response: string }>('/llm/ask', {
    method: 'POST',
    json: { transcript, question },
  });
}
