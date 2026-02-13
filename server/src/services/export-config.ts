/**
 * Centralized export config: decrypt by mode and build config_enc for create/update.
 * Keeps routes thin and avoids repetition across FTP, SFTP, WebDAV, IPFS, SMB, S3.
 *
 * public_base_url is always a plain column on the export row for every mode; it is
 * never stored in config_enc.
 */
import { decryptSecret, encryptSecret, isEncryptedSecret } from "./secrets.js";
import type { FtpConfig } from "./ftp.js";
import type { SftpConfig } from "./sftp.js";
import type { WebdavConfig } from "./webdav.js";
import type { IpfsConfig } from "./ipfs.js";
import type { SmbConfig } from "./smb.js";

const AAD = "harborfm:exports";

export type ExportMode = "S3" | "FTP" | "SFTP" | "WebDAV" | "IPFS" | "SMB";

export interface S3ConfigDecrypted {
  bucket: string;
  prefix: string;
  region: string;
  endpoint?: string | null;
  accessKeyId: string;
  secretAccessKey: string;
}

export type ExportConfigDecrypted =
  | { mode: "S3"; config: S3ConfigDecrypted }
  | { mode: "FTP"; config: FtpConfig }
  | { mode: "SFTP"; config: SftpConfig }
  | { mode: "WebDAV"; config: WebdavConfig }
  | { mode: "IPFS"; config: IpfsConfig }
  | { mode: "SMB"; config: SmbConfig };

function decryptConfigEnc(
  exp: Record<string, unknown>,
): Record<string, unknown> {
  const configEnc = exp.config_enc as string | null | undefined;
  if (!configEnc || !isEncryptedSecret(configEnc)) {
    throw new Error("Missing or invalid export config");
  }
  return JSON.parse(decryptSecret(configEnc, AAD)) as Record<string, unknown>;
}

/** Normalize path: trim and ensure non-empty path ends with exactly one /. */
function normalizePath(path: string | undefined): string {
  const s = String(path ?? "")
    .trim()
    .replace(/\/+$/, "");
  return s ? `${s}/` : "";
}

function parseFtpConfig(raw: Record<string, unknown>): FtpConfig {
  return {
    host: String(raw.host ?? ""),
    port: Number(raw.port) || 21,
    username: String(raw.username ?? ""),
    password: String(raw.password ?? ""),
    path: normalizePath(raw.path as string | undefined),
    secure: Boolean(raw.secure),
  };
}

function parseSftpConfig(raw: Record<string, unknown>): SftpConfig {
  return {
    host: String(raw.host ?? ""),
    port: Number(raw.port) || 22,
    username: String(raw.username ?? ""),
    password: raw.password != null ? String(raw.password) : undefined,
    private_key: raw.private_key != null ? String(raw.private_key) : undefined,
    path: normalizePath(raw.path as string | undefined),
  };
}

function parseWebdavConfig(raw: Record<string, unknown>): WebdavConfig {
  return {
    url: String(raw.url ?? ""),
    username: String(raw.username ?? ""),
    password: String(raw.password ?? ""),
    path: normalizePath(raw.path as string | undefined),
  };
}

function parseIpfsConfig(raw: Record<string, unknown>): IpfsConfig {
  return {
    api_url: String(raw.api_url ?? ""),
    api_key: raw.api_key != null ? String(raw.api_key) : undefined,
    username: raw.username != null ? String(raw.username) : undefined,
    password: raw.password != null ? String(raw.password) : undefined,
    path: normalizePath(raw.path as string | undefined),
    gateway_url: raw.gateway_url != null ? String(raw.gateway_url) : null,
  };
}

function parseSmbConfig(raw: Record<string, unknown>): SmbConfig {
  const port = raw.port != null ? Number(raw.port) : undefined;
  return {
    host: String(raw.host ?? ""),
    port: port && port > 0 ? port : undefined,
    share: String(raw.share ?? ""),
    username: String(raw.username ?? ""),
    password: String(raw.password ?? ""),
    domain: String(raw.domain ?? ""),
    path: normalizePath(raw.path as string | undefined),
  };
}

function parseS3Config(raw: Record<string, unknown>): S3ConfigDecrypted {
  return {
    bucket: String(raw.bucket ?? ""),
    prefix: String(raw.prefix ?? ""),
    region: String(raw.region ?? ""),
    endpoint: raw.endpoint_url != null ? String(raw.endpoint_url) : null,
    accessKeyId: String(raw.access_key_id ?? ""),
    secretAccessKey: String(raw.secret_access_key ?? ""),
  };
}

/**
 * Get decrypted config for any export mode (including S3). All config lives in config_enc.
 */
export function getDecryptedConfigFromEnc(
  exp: Record<string, unknown>,
): ExportConfigDecrypted {
  const mode = ((exp.mode as string) || "S3") as ExportMode;
  const raw = decryptConfigEnc(exp);
  switch (mode) {
    case "S3":
      return { mode: "S3", config: parseS3Config(raw) };
    case "FTP":
      return { mode: "FTP", config: parseFtpConfig(raw) };
    case "SFTP":
      return { mode: "SFTP", config: parseSftpConfig(raw) };
    case "WebDAV":
      return { mode: "WebDAV", config: parseWebdavConfig(raw) };
    case "IPFS":
      return { mode: "IPFS", config: parseIpfsConfig(raw) };
    case "SMB":
      return { mode: "SMB", config: parseSmbConfig(raw) };
    default:
      throw new Error(`Unsupported export mode: ${mode}`);
  }
}

/** Build encrypted JSON for config_enc (all modes). */
export function buildConfigEnc(
  mode: ExportMode,
  data: Record<string, unknown>,
): string {
  const obj: Record<string, unknown> = {};
  switch (mode) {
    case "S3":
      obj.bucket = data.bucket;
      obj.prefix = data.prefix ?? "";
      obj.region = data.region;
      obj.endpoint_url = data.endpoint_url ?? null;
      obj.access_key_id = data.access_key_id;
      obj.secret_access_key = data.secret_access_key;
      break;
    case "FTP":
      obj.host = data.host;
      obj.port = data.port ?? 21;
      obj.username = data.username;
      obj.password = data.password;
      obj.path = normalizePath(data.path as string | undefined);
      obj.secure = data.secure ?? false;
      break;
    case "SFTP": {
      const privateKey = String(data.private_key ?? "").trim();
      obj.host = data.host;
      obj.port = data.port ?? 22;
      obj.username = data.username;
      obj.password = privateKey ? "" : (data.password ?? "");
      obj.private_key = data.private_key ?? "";
      obj.path = normalizePath(data.path as string | undefined);
      break;
    }
    case "WebDAV":
      obj.url = data.url;
      obj.username = data.username;
      obj.password = data.password;
      obj.path = normalizePath(data.path as string | undefined);
      break;
    case "IPFS":
      obj.api_url = data.api_url;
      obj.api_key = data.api_key ?? "";
      obj.username = data.username ?? "";
      obj.password = data.password ?? "";
      obj.path = normalizePath(data.path as string | undefined);
      obj.gateway_url = data.gateway_url ?? null;
      break;
    case "SMB": {
      const smbPort = data.port != null ? Number(data.port) : undefined;
      obj.host = data.host;
      obj.port = smbPort && smbPort > 0 ? smbPort : undefined;
      obj.share = data.share;
      obj.username = data.username;
      obj.password = data.password;
      obj.domain = data.domain ?? "";
      obj.path = normalizePath(data.path as string | undefined);
      break;
    }
    default:
      throw new Error(`Unsupported export mode: ${mode}`);
  }
  return encryptSecret(JSON.stringify(obj), AAD);
}

/** Keys stored in config_enc by mode. public_base_url is always a plain column on the export row. */
const CONFIG_KEYS = new Set([
  "bucket",
  "prefix",
  "region",
  "endpoint_url",
  "access_key_id",
  "secret_access_key",
  "host",
  "port",
  "username",
  "password",
  "path",
  "secure",
  "private_key",
  "url",
  "api_url",
  "api_key",
  "gateway_url",
  "share",
  "domain",
]);

/** Merge partial update into existing decrypted config and return new encrypted JSON. */
export function mergeAndEncryptConfig(
  exp: Record<string, unknown>,
  update: Record<string, unknown>,
): string {
  const raw = decryptConfigEnc(exp);
  const mode = (exp.mode as ExportMode) || "S3";
  const merged = { ...raw };
  for (const [k, v] of Object.entries(update)) {
    if (v !== undefined && CONFIG_KEYS.has(k))
      (merged as Record<string, unknown>)[k] = v;
  }
  if (merged.path !== undefined)
    (merged as Record<string, unknown>).path = normalizePath(
      merged.path as string,
    );
  if (mode === "SFTP" && String(merged.private_key ?? "").trim()) {
    (merged as Record<string, unknown>).password = "";
  }
  // public_base_url is always a plain column; never store in config_enc
  delete (merged as Record<string, unknown>).public_base_url;
  return encryptSecret(JSON.stringify(merged), AAD);
}

/**
 * Return the path/prefix segment used for public URLs (feed and enclosures). S3 uses prefix, others use path.
 */
export function getExportPathPrefix(
  exp: Record<string, unknown>,
): string | null {
  const mode = (exp.mode as ExportMode) || "S3";
  try {
    const raw = decryptConfigEnc(exp);
    if (mode === "S3") {
      const p = raw.prefix != null ? String(raw.prefix).trim() : "";
      return p ? p.replace(/^\/|\/$/g, "") : null;
    }
    const p = raw.path != null ? String(raw.path).trim() : "";
    return p ? p.replace(/^\/|\/$/g, "") : null;
  } catch {
    return null;
  }
}
