import { apiGet } from './client';

export function getAsrAvailable() {
  return apiGet<{ available: boolean }>('/asr/available');
}

