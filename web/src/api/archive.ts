import type { ArchiveSettingsUpsert, ArchiveSettingsUpdate, ExportMode } from '@harborfm/shared';
import { apiDelete, apiGet, apiPost, apiPut } from './client';

export type { ArchiveSettingsUpsert, ArchiveSettingsUpdate };

export interface ArchiveSettings {
  podcastId: string;
  mode: string;
  name: string;
  bucket: string | null;
  prefix: string | null;
  region: string | null;
  endpointUrl: string | null;
  createdAt: string;
  updatedAt: string;
  hasCredentials: boolean;
  configured: boolean;
}

export function getArchiveSettings(podcastId: string) {
  return apiGet<{ configured: boolean; settings: ArchiveSettings | null }>(
    `/podcasts/${podcastId}/archive-settings`,
  );
}

export function upsertArchiveSettings(podcastId: string, body: ArchiveSettingsUpsert) {
  return apiPut<{ configured: boolean; settings: ArchiveSettings }>(
    `/podcasts/${podcastId}/archive-settings`,
    body,
  );
}

export function updateArchiveSettings(podcastId: string, body: ArchiveSettingsUpdate) {
  return apiPut<{ configured: boolean; settings: ArchiveSettings }>(
    `/podcasts/${podcastId}/archive-settings`,
    body,
  );
}

export function deleteArchiveSettings(podcastId: string) {
  return apiDelete(`/podcasts/${podcastId}/archive-settings`);
}

export function testArchiveSettings(podcastId: string) {
  return apiPost<{ ok: boolean; error?: string }>(
    `/podcasts/${podcastId}/archive-settings/test`,
  );
}

export function isArchiveConfigured(podcastId: string) {
  return apiGet<{ configured: boolean }>(`/podcasts/${podcastId}/archive-configured`);
}

export function archiveEpisode(episodeId: string) {
  return apiPost<{
    archivedAt: string;
    archiveRemotePath: string;
    archiveSha256: string;
    archiveBytes: number;
    archiveFilename: string;
    episode: unknown;
  }>(`/episodes/${episodeId}/archive`);
}

export function backupEpisode(episodeId: string, opts?: { dated?: boolean }) {
  return apiPost<{
    backupRemotePath: string;
    backupSha256: string;
    backupBytes: number;
    backupFilename: string;
  }>(`/episodes/${episodeId}/backup`, { dated: Boolean(opts?.dated) });
}

export type EpisodeBackupItem = {
  filename: string;
  remotePath: string;
  size: number;
  lastModified: string | null;
};

export function listEpisodeBackups(episodeId: string) {
  return apiGet<{ backups: EpisodeBackupItem[] }>(`/episodes/${episodeId}/backups`);
}

export function restoreEpisodeBackup(episodeId: string, filename: string) {
  return apiPost<{
    warning: string | null;
    episode: unknown;
    error?: string;
    code?: string;
  }>(`/episodes/${episodeId}/backups/restore`, { filename });
}

export function restoreEpisode(episodeId: string) {
  return apiPost<{
    warning: string | null;
    episode: unknown;
    error?: string;
    code?: string;
  }>(`/episodes/${episodeId}/restore`);
}

export const ARCHIVE_MODE_LABELS: Record<ExportMode, string> = {
  S3: 'S3',
  FTP: 'FTP',
  SFTP: 'SFTP',
  WebDAV: 'WebDAV',
  IPFS: 'IPFS',
  SMB: 'SMB',
};
