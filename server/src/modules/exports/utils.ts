import { existsSync } from "fs";
import { getDecryptedConfigFromEnc } from "../../services/export-config.js";
import { getPodcastRole, canEditEpisodeOrPodcastMetadata } from "../../services/access.js";
import { chaptersJsonPath, transcriptSrtPath, resolveDataPath } from "../../services/paths.js";
import { testS3Access, deployPodcastToS3 } from "../../services/s3.js";
import { testFtpAccess, deployPodcastToFtp } from "../../services/ftp.js";
import { testSftpAccess, deployPodcastToSftp } from "../../services/sftp.js";
import { testWebdavAccess, deployPodcastToWebdav } from "../../services/webdav.js";
import { testIpfsAccess, deployPodcastToIpfs } from "../../services/ipfs.js";
import { testSmbAccess, deployPodcastToSmb } from "../../services/smb.js";
import * as repo from "./repo.js";

export type { ExportRow } from "./repo.js";

export function getExport(userId: string, exportId: string): repo.ExportRow | null {
  const row = repo.getById(exportId);
  if (!row) return null;
  const role = getPodcastRole(userId, row.podcastId);
  if (!canEditEpisodeOrPodcastMetadata(role)) return null;
  return row;
}

export function exportDto(row: repo.ExportRow) {
  const mode = row.mode ?? "S3";
  let bucket: string | null = null;
  let prefix: string | null = null;
  let region: string | null = null;
  let endpointUrl: string | null = null;
  if (mode === "S3") {
    try {
      const out = getDecryptedConfigFromEnc(row);
      if (out.mode === "S3") {
        bucket = out.config.bucket ?? null;
        prefix = out.config.prefix ?? null;
        region = out.config.region ?? null;
        endpointUrl = null;
      }
    } catch {
      // config missing or invalid
    }
  }
  return {
    id: row.id,
    podcastId: row.podcastId,
    provider: mode.toLowerCase(),
    mode,
    name: row.name,
    bucket,
    prefix,
    region,
    endpointUrl,
    publicBaseUrl: row.publicBaseUrl ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    hasCredentials: true,
  };
}

export type DeployParams = {
  publicBaseUrl: string | null;
  xml: string;
  episodes: {
    id: string;
    audio_final_path: string | null;
    audio_mime?: string | null;
    artwork_path?: string | null;
    transcript_srt_path?: string | null;
    chapters_json_path?: string | null;
  }[];
  artworkPath: string | null;
  podcastId: string;
};

export async function runDeploy(
  mode: string,
  config: unknown,
  params: DeployParams,
): Promise<{ uploaded: number; skipped: number; errors: string[] }> {
  const { publicBaseUrl, xml, episodes, artworkPath, podcastId } = params;
  switch (mode) {
    case "S3":
      return deployPodcastToS3(
        config as Parameters<typeof deployPodcastToS3>[0],
        publicBaseUrl,
        xml,
        episodes,
        artworkPath,
      );
    case "FTP":
      return deployPodcastToFtp(
        config as Parameters<typeof deployPodcastToFtp>[0],
        publicBaseUrl,
        xml,
        episodes,
        artworkPath,
      );
    case "SFTP":
      return deployPodcastToSftp(
        config as Parameters<typeof deployPodcastToSftp>[0],
        publicBaseUrl,
        xml,
        episodes,
        artworkPath,
      );
    case "WebDAV":
      return deployPodcastToWebdav(
        config as Parameters<typeof deployPodcastToWebdav>[0],
        publicBaseUrl,
        xml,
        episodes,
        artworkPath,
      );
    case "IPFS":
      return deployPodcastToIpfs(
        config as Parameters<typeof deployPodcastToIpfs>[0],
        publicBaseUrl,
        xml,
        episodes,
        artworkPath,
        podcastId,
      );
    case "SMB":
      return deployPodcastToSmb(
        config as Parameters<typeof deployPodcastToSmb>[0],
        publicBaseUrl,
        xml,
        episodes,
        artworkPath,
      );
    default:
      return { uploaded: 0, skipped: 0, errors: [`Unsupported mode: ${mode}`] };
  }
}

export function runTest(
  mode: string,
  config: unknown,
): Promise<{ ok: boolean; error?: string }> {
  switch (mode) {
    case "S3":
      return testS3Access(config as Parameters<typeof testS3Access>[0]);
    case "FTP":
      return testFtpAccess(config as Parameters<typeof testFtpAccess>[0]);
    case "SFTP":
      return testSftpAccess(config as Parameters<typeof testSftpAccess>[0]);
    case "WebDAV":
      return testWebdavAccess(config as Parameters<typeof testWebdavAccess>[0]);
    case "IPFS":
      return testIpfsAccess(config as Parameters<typeof testIpfsAccess>[0]);
    case "SMB":
      return testSmbAccess(config as Parameters<typeof testSmbAccess>[0]);
    default:
      return Promise.resolve({ ok: false, error: `Unsupported mode: ${mode}` });
  }
}

/** Map repo episode rows + podcastId to DeployParams.episodes shape. */
export function buildDeployEpisodes(
  podcastId: string,
  episodeRows: repo.PublishedEpisodeRow[],
): DeployParams["episodes"] {
  return episodeRows.map((ep) => ({
    id: ep.id,
    audio_final_path: ep.audioFinalPath
      ? resolveDataPath(ep.audioFinalPath)
      : null,
    audio_mime: ep.audioMime ?? null,
    artwork_path: ep.artworkPath
      ? resolveDataPath(ep.artworkPath)
      : null,
    transcript_srt_path: existsSync(transcriptSrtPath(podcastId, ep.id))
      ? transcriptSrtPath(podcastId, ep.id)
      : null,
    chapters_json_path: existsSync(chaptersJsonPath(podcastId, ep.id))
      ? chaptersJsonPath(podcastId, ep.id)
      : null,
  }));
}
