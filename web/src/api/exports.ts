import type { ExportCreate, ExportMode, ExportUpdate } from '@harborfm/shared';
import { apiDelete, apiGet, apiPatch, apiPost } from './client';

export type { ExportCreate, ExportMode, ExportUpdate };

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

export function listExports(podcastId: string) {
  return apiGet<{ exports: Export[] }>(`/podcasts/${podcastId}/exports`).then((r) => r.exports);
}

export function createExport(podcastId: string, body: ExportCreate) {
  return apiPost<Export>(`/podcasts/${podcastId}/exports`, body);
}

export function updateExport(exportId: string, body: ExportUpdate) {
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
