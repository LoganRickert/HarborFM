import { apiGet, apiPost, apiPatch, apiDelete } from './client';

export interface ApiKeyRecord {
  id: string;
  name: string | null;
  valid_until: string | null;
  valid_from: string | null;
  disabled: number;
  created_at: string;
  last_used_at: string | null;
}

export interface ApiKeysListResponse {
  api_keys: ApiKeyRecord[];
  total: number;
}

export interface ApiKeyCreateResponse {
  id: string;
  key: string;
  name: string | null;
  valid_until: string | null;
  valid_from: string | null;
  disabled: number;
  created_at: string;
}

export function listApiKeys(params?: {
  limit?: number;
  offset?: number;
  q?: string;
  sort?: 'newest' | 'oldest';
}): Promise<ApiKeysListResponse> {
  const searchParams = new URLSearchParams();
  if (params?.limit != null) searchParams.set('limit', String(params.limit));
  if (params?.offset != null) searchParams.set('offset', String(params.offset));
  if (params?.q) searchParams.set('q', params.q);
  if (params?.sort) searchParams.set('sort', params.sort);
  const query = searchParams.toString();
  const url = `/auth/api-keys${query ? `?${query}` : ''}`;
  return apiGet<ApiKeysListResponse>(url);
}

export function createApiKey(body?: {
  name?: string;
  valid_until?: string;
  valid_from?: string;
}): Promise<ApiKeyCreateResponse> {
  return apiPost<ApiKeyCreateResponse>('/auth/api-keys', body ?? {});
}

export function updateApiKey(
  id: string,
  body: {
    name?: string;
    valid_until?: string;
    valid_from?: string;
    disabled?: boolean;
  }
): Promise<ApiKeyRecord> {
  return apiPatch<ApiKeyRecord>(
    `/auth/api-keys/${encodeURIComponent(id)}`,
    body
  );
}

export function revokeApiKey(id: string): Promise<void> {
  return apiDelete(`/auth/api-keys/${encodeURIComponent(id)}`);
}
