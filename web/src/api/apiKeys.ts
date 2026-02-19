import { apiGet, apiPost, apiPatch, apiDelete } from './client';

export interface ApiKeyRecord {
  id: string;
  name: string | null;
  validUntil: string | null;
  validFrom: string | null;
  disabled: number;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface ApiKeysListResponse {
  apiKeys: ApiKeyRecord[];
  total: number;
}

export interface ApiKeyCreateResponse {
  id: string;
  key: string;
  name: string | null;
  validUntil: string | null;
  validFrom: string | null;
  disabled: number;
  createdAt: string;
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
  validUntil?: string;
  validFrom?: string;
}): Promise<ApiKeyCreateResponse> {
  return apiPost<ApiKeyCreateResponse>('/auth/api-keys', body ?? {});
}

export function updateApiKey(
  id: string,
  body: {
    name?: string;
    validUntil?: string;
    validFrom?: string;
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
