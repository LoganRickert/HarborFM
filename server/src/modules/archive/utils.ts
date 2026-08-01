import {
  ARCHIVE_AAD,
  buildConfigEnc,
  getDecryptedConfigFromEnc,
  mergeAndEncryptConfig,
  type ExportMode,
} from "../../services/export-config.js";
import * as repo from "./repo.js";

export function archiveSettingsDto(row: repo.ArchiveSettingsRow) {
  const mode = row.mode ?? "S3";
  let bucket: string | null = null;
  let prefix: string | null = null;
  let region: string | null = null;
  let endpointUrl: string | null = null;
  if (mode === "S3") {
    try {
      const out = getDecryptedConfigFromEnc(row, ARCHIVE_AAD);
      if (out.mode === "S3") {
        bucket = out.config.bucket ?? null;
        prefix = out.config.prefix ?? null;
        region = out.config.region ?? null;
        endpointUrl = out.config.endpoint ?? null;
      }
    } catch {
      // config missing or invalid
    }
  }
  return {
    podcastId: row.podcastId,
    mode,
    name: row.name,
    bucket,
    prefix,
    region,
    endpointUrl,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    hasCredentials: true,
    configured: true,
  };
}

export function buildArchiveConfigEnc(
  mode: ExportMode,
  data: Record<string, unknown>,
): string {
  return buildConfigEnc(mode, data, ARCHIVE_AAD);
}

export function mergeArchiveConfig(
  row: repo.ArchiveSettingsRow,
  update: Record<string, unknown>,
): string {
  return mergeAndEncryptConfig(row, update, ARCHIVE_AAD);
}

export function getDecryptedArchiveConfig(row: repo.ArchiveSettingsRow) {
  return getDecryptedConfigFromEnc(row, ARCHIVE_AAD);
}
