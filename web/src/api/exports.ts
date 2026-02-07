import { apiGet, apiPatch, apiPost } from './client';

export interface Export {
  id: string;
  podcast_id: string;
  provider: string;
  name: string;
  bucket: string;
  prefix: string;
  region: string;
  endpoint_url: string | null;
  public_base_url: string | null;
  created_at: string;
  updated_at: string;
  has_credentials: boolean;
}

export function listExports(podcastId: string) {
  return apiGet<{ exports: Export[] }>(`/podcasts/${podcastId}/exports`).then((r) => r.exports);
}

export function createExport(
  podcastId: string,
  body: {
    provider: 's3';
    name: string;
    bucket: string;
    prefix: string;
    region: string;
    endpoint_url?: string | null;
    access_key_id: string;
    secret_access_key: string;
    public_base_url?: string | null;
  }
) {
  return apiPost<Export>(`/podcasts/${podcastId}/exports`, body);
}

export function updateExport(
  exportId: string,
  body: Partial<{
    name: string;
    bucket: string;
    prefix: string;
    region: string;
    endpoint_url: string | null;
    access_key_id: string;
    secret_access_key: string;
    public_base_url: string | null;
  }>
) {
  return apiPatch<Export>(`/exports/${exportId}`, body);
}

export function testExport(exportId: string) {
  return apiPost<{ ok: boolean; error?: string }>(`/exports/${exportId}/test`);
}

export function deployExport(exportId: string) {
  return apiPost<{ run_id: string; status: string; uploaded: number; skipped?: number; errors?: string[] }>(
    `/exports/${exportId}/deploy`
  );
}

export function getExportRun(runId: string) {
  return apiGet<{ id: string; status: string; log: string | null; started_at: string; finished_at: string | null }>(
    `/export-runs/${runId}`
  );
}
