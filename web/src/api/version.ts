import { apiGet } from './client';

export function getVersion() {
  return apiGet<{ version: string }>('/version');
}
