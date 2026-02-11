import { apiDelete, apiGet, apiPatch, apiPost } from './client';

export type ExportMode = 'S3' | 'FTP' | 'SFTP' | 'WebDAV' | 'IPFS' | 'SMB';

export interface Export {
  id: string;
  podcast_id: string;
  provider: string;
  mode: string;
  name: string;
  /** null when stored encrypted (not visible after save) */
  bucket: string | null;
  prefix: string;
  /** null when stored encrypted */
  region: string | null;
  endpoint_url: string | null;
  public_base_url: string | null;
  created_at: string;
  updated_at: string;
  has_credentials: boolean;
}

/** Create payload: mode + name + mode-specific fields (backend validates with exportCreateSchema). */
export type ExportCreateBody =
  | { mode: 'S3'; name: string; bucket: string; prefix?: string; region: string; endpoint_url?: string | null; access_key_id: string; secret_access_key: string; public_base_url?: string | null }
  | { mode: 'FTP'; name: string; host: string; port?: number; username: string; password: string; path?: string; secure?: boolean; public_base_url?: string | null }
  | { mode: 'SFTP'; name: string; host: string; port?: number; username: string; password?: string; private_key?: string; path?: string; public_base_url?: string | null }
  | { mode: 'WebDAV'; name: string; url: string; username: string; password: string; path?: string; public_base_url?: string | null }
  | { mode: 'IPFS'; name: string; api_url: string; api_key?: string; username?: string; password?: string; path?: string; gateway_url?: string | null; public_base_url?: string | null }
  | { mode: 'SMB'; name: string; host: string; port?: number; share: string; username: string; password: string; domain?: string; path?: string; public_base_url?: string | null };

export type ExportUpdateBody = Partial<{
  mode: ExportMode;
  name: string;
  prefix: string;
  public_base_url: string | null;
  bucket: string;
  region: string;
  endpoint_url: string | null;
  access_key_id: string;
  secret_access_key: string;
  host: string;
  port: number;
  username: string;
  password: string;
  path: string;
  secure: boolean;
  private_key: string;
  url: string;
  api_url: string;
  api_key: string;
  gateway_url: string | null;
  share: string;
  domain: string;
}>;

export function listExports(podcastId: string) {
  return apiGet<{ exports: Export[] }>(`/podcasts/${podcastId}/exports`).then((r) => r.exports);
}

export function createExport(podcastId: string, body: ExportCreateBody) {
  return apiPost<Export>(`/podcasts/${podcastId}/exports`, body);
}

export function updateExport(exportId: string, body: ExportUpdateBody) {
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

export function deployAllExports(podcastId: string) {
  return apiPost<{
    results: { export_id: string; name: string; status: string; uploaded: number; skipped: number; errors?: string[] }[];
  }>(`/podcasts/${podcastId}/exports/deploy`);
}

export function deleteExport(exportId: string) {
  return apiDelete(`/exports/${exportId}`);
}

export function getExportRun(runId: string) {
  return apiGet<{ id: string; status: string; log: string | null; started_at: string; finished_at: string | null }>(
    `/export-runs/${runId}`
  );
}

export const EXPORT_MODE_LABELS: Record<ExportMode, string> = {
  S3: 'S3',
  FTP: 'FTP',
  SFTP: 'SFTP',
  WebDAV: 'WebDAV',
  IPFS: 'IPFS',
  SMB: 'SMB',
};
