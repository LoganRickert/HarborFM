/**
 * Shared types for podcast deploy across S3, FTP, SFTP, WebDAV, IPFS, SMB.
 */
export interface DeployEpisode {
  id: string;
  audio_final_path: string | null;
  audio_mime?: string | null;
  artwork_path?: string | null;
  transcript_srt_path?: string | null;
}

export interface DeployResult {
  uploaded: number;
  skipped: number;
  errors: string[];
}
