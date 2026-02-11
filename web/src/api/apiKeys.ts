import { apiGet, apiPost, apiDelete } from './client';

export interface ApiKeyRecord {
  id: string;
  created_at: string;
  last_used_at: string | null;
}

export interface ApiKeysListResponse {
  api_keys: ApiKeyRecord[];
}

export interface ApiKeyCreateResponse {
  id: string;
  key: string;
  created_at: string;
}

export function listApiKeys(): Promise<ApiKeysListResponse> {
  return apiGet<ApiKeysListResponse>('/auth/api-keys');
}

export function createApiKey(): Promise<ApiKeyCreateResponse> {
  return apiPost<ApiKeyCreateResponse>('/auth/api-keys', {});
}

export function revokeApiKey(id: string): Promise<void> {
  return apiDelete(`/auth/api-keys/${encodeURIComponent(id)}`);
}
