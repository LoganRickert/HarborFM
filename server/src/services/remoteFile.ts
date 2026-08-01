/**
 * Single-file upload / stat / download across delivery destination modes.
 * Used by episode archive (and available for other one-off remote file ops).
 */
import {
  readFileSync,
  statSync,
  writeFileSync,
  mkdtempSync,
  rmSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Readable, Writable } from "stream";
import { Client } from "basic-ftp";
import SftpClient from "ssh2-sftp-client";
import { createClient } from "webdav";
import { create } from "kubo-rpc-client";
import SambaClient from "samba-client";
import { FTP_CLIENT_TIMEOUT_MS, APP_NAME_SLUG } from "../config.js";
import { md5Hex, MD5_SUFFIX } from "../utils/hash.js";
import type { ExportMode, ExportConfigDecrypted } from "./export-config.js";
import {
  uploadArchiveObject,
  statObject,
  downloadObjectToFile,
  listObjectsUnderPrefix,
  ArchiveColdStorageError,
  type S3Config,
} from "./s3.js";
import type { FtpConfig } from "./ftp.js";
import type { SftpConfig } from "./sftp.js";
import type { WebdavConfig } from "./webdav.js";
import type { IpfsConfig } from "./ipfs.js";
import type { SmbConfig } from "./smb.js";
import { ensureSmbclientInstalled } from "./smb.js";

export { ArchiveColdStorageError };

export type RemoteFileStat = {
  size: number;
  md5?: string | null;
  storageClass?: string | null;
  restore?: string | null;
};

function joinRemote(base: string, ...parts: string[]): string {
  const normalized = base.replace(/\/+$/, "");
  const joined = [normalized, ...parts]
    .filter(Boolean)
    .join("/")
    .replace(/\/+/g, "/");
  return joined.replace(/^\//, "") || "";
}

function ftpRemoteFull(basePath: string, remotePath: string): string {
  const combined = basePath ? joinRemote(basePath, remotePath) : remotePath;
  return combined ? `/${combined}` : "/";
}

function ReadableFrom(buf: Buffer): Readable {
  return Readable.from(buf);
}

async function ensureWebdavDir(
  client: ReturnType<typeof createClient>,
  dirPath: string,
): Promise<void> {
  if (!dirPath) return;
  const parts = dirPath.split("/").filter(Boolean);
  let acc = "";
  for (const p of parts) {
    acc = acc ? `${acc}/${p}` : p;
    try {
      await client.createDirectory(acc);
    } catch {
      // may already exist
    }
  }
}

async function uploadFtp(
  config: FtpConfig,
  remotePath: string,
  body: Buffer,
): Promise<void> {
  const client = new Client(FTP_CLIENT_TIMEOUT_MS, {
    allowSeparateTransferHost: false,
  });
  try {
    await client.access({
      host: config.host,
      port: config.port,
      user: config.username,
      password: config.password,
      secure: config.secure ? true : false,
    });
    const full = ftpRemoteFull(config.path, remotePath);
    const dir = full.includes("/") ? full.replace(/\/[^/]+$/, "") : "";
    if (dir) await client.ensureDir(dir);
    await client.uploadFrom(ReadableFrom(body), full);
    await client.uploadFrom(
      ReadableFrom(Buffer.from(md5Hex(body), "utf8")),
      full + MD5_SUFFIX,
    );
  } finally {
    client.close();
  }
}

async function statFtp(
  config: FtpConfig,
  remotePath: string,
): Promise<RemoteFileStat | null> {
  const client = new Client(FTP_CLIENT_TIMEOUT_MS, {
    allowSeparateTransferHost: false,
  });
  try {
    await client.access({
      host: config.host,
      port: config.port,
      user: config.username,
      password: config.password,
      secure: config.secure ? true : false,
    });
    const full = ftpRemoteFull(config.path, remotePath);
    const size = await client.size(full);
    let md5: string | null = null;
    try {
      const chunks: Buffer[] = [];
      const writable = new Writable({
        write(chunk: Buffer, _enc, cb) {
          chunks.push(Buffer.from(chunk));
          cb();
        },
      });
      await client.downloadTo(writable, full + MD5_SUFFIX);
      md5 = Buffer.concat(chunks).toString("utf8").trim();
    } catch {
      md5 = null;
    }
    return { size, md5 };
  } catch {
    return null;
  } finally {
    client.close();
  }
}

async function downloadFtp(
  config: FtpConfig,
  remotePath: string,
  destPath: string,
): Promise<void> {
  const client = new Client(FTP_CLIENT_TIMEOUT_MS, {
    allowSeparateTransferHost: false,
  });
  try {
    await client.access({
      host: config.host,
      port: config.port,
      user: config.username,
      password: config.password,
      secure: config.secure ? true : false,
    });
    const full = ftpRemoteFull(config.path, remotePath);
    await client.downloadTo(destPath, full);
  } finally {
    client.close();
  }
}

async function sftpConnect(config: SftpConfig): Promise<SftpClient> {
  const sftp = new SftpClient();
  const connectOpts: Record<string, unknown> = {
    host: config.host,
    port: config.port,
    username: config.username,
  };
  if (config.private_key?.trim()) {
    connectOpts.privateKey = config.private_key.trim();
  } else if (config.password != null && config.password !== "") {
    connectOpts.password = config.password;
  } else {
    throw new Error("Provide either password or private_key");
  }
  await sftp.connect(connectOpts);
  return sftp;
}

async function uploadSftp(
  config: SftpConfig,
  remotePath: string,
  body: Buffer,
): Promise<void> {
  const sftp = await sftpConnect(config);
  try {
    const full = config.path ? joinRemote(config.path, remotePath) : remotePath;
    const dir = full.includes("/") ? full.replace(/\/[^/]+$/, "") : "";
    if (dir) await sftp.mkdir(dir, true);
    await sftp.put(body, full);
    await sftp.put(Buffer.from(md5Hex(body), "utf8"), full + MD5_SUFFIX);
  } finally {
    await sftp.end();
  }
}

async function statSftp(
  config: SftpConfig,
  remotePath: string,
): Promise<RemoteFileStat | null> {
  const sftp = await sftpConnect(config);
  try {
    const full = config.path ? joinRemote(config.path, remotePath) : remotePath;
    const st = await sftp.stat(full);
    let md5: string | null = null;
    try {
      const data = await sftp.get(full + MD5_SUFFIX);
      if (Buffer.isBuffer(data)) md5 = data.toString("utf8").trim();
    } catch {
      md5 = null;
    }
    return { size: st.size, md5 };
  } catch {
    return null;
  } finally {
    await sftp.end();
  }
}

async function downloadSftp(
  config: SftpConfig,
  remotePath: string,
  destPath: string,
): Promise<void> {
  const sftp = await sftpConnect(config);
  try {
    const full = config.path ? joinRemote(config.path, remotePath) : remotePath;
    await sftp.fastGet(full, destPath);
  } finally {
    await sftp.end();
  }
}

async function uploadWebdav(
  config: WebdavConfig,
  remotePath: string,
  body: Buffer,
): Promise<void> {
  const client = createClient(config.url.trim(), {
    username: config.username,
    password: config.password,
  });
  const basePath = config.path ? joinRemote(config.path) : "";
  const full = basePath ? joinRemote(basePath, remotePath) : remotePath;
  const dir = full.includes("/") ? full.replace(/\/[^/]+$/, "") : "";
  await ensureWebdavDir(client, dir);
  await client.putFileContents(full, body);
  await client.putFileContents(
    full + MD5_SUFFIX,
    Buffer.from(md5Hex(body), "utf8"),
  );
}

async function statWebdav(
  config: WebdavConfig,
  remotePath: string,
): Promise<RemoteFileStat | null> {
  const client = createClient(config.url.trim(), {
    username: config.username,
    password: config.password,
  });
  const basePath = config.path ? joinRemote(config.path) : "";
  const full = basePath ? joinRemote(basePath, remotePath) : remotePath;
  try {
    const st = await client.stat(full);
    const size =
      typeof st === "object" && st != null && "size" in st
        ? Number((st as { size?: number }).size ?? 0)
        : 0;
    let md5: string | null = null;
    try {
      const existing = await client.getFileContents(full + MD5_SUFFIX);
      const raw =
        typeof existing === "object" && existing != null && "data" in existing
          ? (existing as { data: unknown }).data
          : existing;
      const buf =
        raw instanceof ArrayBuffer
          ? Buffer.from(raw)
          : typeof raw === "string"
            ? Buffer.from(raw, "utf8")
            : Buffer.isBuffer(raw)
              ? raw
              : Buffer.from(raw as ArrayLike<number>);
      md5 = buf.toString("utf8").trim();
    } catch {
      md5 = null;
    }
    return { size, md5 };
  } catch {
    return null;
  }
}

async function downloadWebdav(
  config: WebdavConfig,
  remotePath: string,
  destPath: string,
): Promise<void> {
  const client = createClient(config.url.trim(), {
    username: config.username,
    password: config.password,
  });
  const basePath = config.path ? joinRemote(config.path) : "";
  const full = basePath ? joinRemote(basePath, remotePath) : remotePath;
  const contents = await client.getFileContents(full);
  const raw =
    typeof contents === "object" && contents != null && "data" in contents
      ? (contents as { data: unknown }).data
      : contents;
  const buf =
    raw instanceof ArrayBuffer
      ? Buffer.from(raw)
      : typeof raw === "string"
        ? Buffer.from(raw)
        : Buffer.isBuffer(raw)
          ? raw
          : Buffer.from(raw as ArrayLike<number>);
  writeFileSync(destPath, buf);
}

function normalizeIpfsApiUrl(url: string): string {
  const u = url.trim().replace(/\/+$/, "");
  return u.endsWith("/api/v0") ? u : `${u}/api/v0`;
}

function createIpfsClient(config: IpfsConfig) {
  const url = normalizeIpfsApiUrl(config.api_url);
  const options: { url: string; headers?: Record<string, string> } = { url };
  if (config.api_key?.trim()) {
    options.headers = { authorization: `Bearer ${config.api_key.trim()}` };
  } else if (
    config.username != null &&
    config.username !== "" &&
    config.password != null
  ) {
    const basic = Buffer.from(
      `${config.username}:${config.password}`,
      "utf8",
    ).toString("base64");
    options.headers = { authorization: `Basic ${basic}` };
  }
  return create(options);
}

function ipfsMfsPath(config: IpfsConfig, remotePath: string): string {
  const basePath = config.path ? joinRemote(config.path).replace(/^\//, "") : "";
  const mfsRoot = basePath ? `/${basePath}` : "/deploy";
  return mfsRoot + (remotePath.startsWith("/") ? remotePath : `/${remotePath}`);
}

async function uploadIpfs(
  config: IpfsConfig,
  remotePath: string,
  body: Buffer,
): Promise<void> {
  const client = createIpfsClient(config);
  const fullPath = ipfsMfsPath(config, remotePath);
  const dir = fullPath.replace(/\/[^/]+$/, "");
  if (dir) {
    try {
      await client.files.mkdir(dir, { parents: true });
    } catch {
      // may already exist
    }
  }
  await client.files.write(fullPath, body, { create: true, truncate: true });
  await client.files.write(
    fullPath + MD5_SUFFIX,
    Buffer.from(md5Hex(body), "utf8"),
    { create: true, truncate: true },
  );
}

async function statIpfs(
  config: IpfsConfig,
  remotePath: string,
): Promise<RemoteFileStat | null> {
  const client = createIpfsClient(config);
  const fullPath = ipfsMfsPath(config, remotePath);
  try {
    const st = await client.files.stat(fullPath);
    let md5: string | null = null;
    try {
      const chunks: Uint8Array[] = [];
      for await (const chunk of client.files.read(fullPath + MD5_SUFFIX)) {
        chunks.push(chunk);
      }
      md5 = Buffer.concat(chunks).toString("utf8").trim();
    } catch {
      md5 = null;
    }
    return { size: st.size, md5 };
  } catch {
    return null;
  }
}

async function downloadIpfs(
  config: IpfsConfig,
  remotePath: string,
  destPath: string,
): Promise<void> {
  const client = createIpfsClient(config);
  const fullPath = ipfsMfsPath(config, remotePath);
  const chunks: Uint8Array[] = [];
  for await (const chunk of client.files.read(fullPath)) {
    chunks.push(chunk);
  }
  writeFileSync(destPath, Buffer.concat(chunks));
}

function smbAddress(host: string, share: string): string {
  const h = host.replace(/^\/\/?|\\+|\/+$/g, "");
  const s = share.replace(/^\/\/?|\\+|\/+$/g, "");
  return `//${h}/${s}`;
}

function createSmbClient(config: SmbConfig): SambaClient {
  const opts: {
    address: string;
    username: string;
    password: string;
    domain?: string;
    port?: number;
  } = {
    address: smbAddress(config.host, config.share),
    username: config.username,
    password: config.password,
    domain: config.domain || undefined,
  };
  if (config.port != null && config.port > 0) opts.port = config.port;
  return new SambaClient(opts);
}

async function uploadSmb(
  config: SmbConfig,
  remotePath: string,
  body: Buffer,
): Promise<void> {
  ensureSmbclientInstalled();
  const client = createSmbClient(config);
  const basePath = config.path ? joinRemote(config.path) : "";
  const full = basePath ? joinRemote(basePath, remotePath) : remotePath;
  const tempDir = mkdtempSync(join(tmpdir(), `${APP_NAME_SLUG}-smb-archive-`));
  try {
    const dir = full.includes("/") ? full.replace(/\/[^/]+$/, "") : "";
    if (dir) {
      const parts = dir.split("/").filter(Boolean);
      let acc = "";
      for (const p of parts) {
        acc = acc ? `${acc}/${p}` : p;
        try {
          await client.mkdir(acc, "");
        } catch {
          // may already exist
        }
      }
    }
    const localPath = join(tempDir, "archive.bin");
    writeFileSync(localPath, body);
    await client.sendFile(localPath, full);
    const md5Path = join(tempDir, ".md5");
    writeFileSync(md5Path, md5Hex(body), "utf8");
    await client.sendFile(md5Path, full + MD5_SUFFIX);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function statSmb(
  config: SmbConfig,
  remotePath: string,
): Promise<RemoteFileStat | null> {
  ensureSmbclientInstalled();
  const client = createSmbClient(config);
  const basePath = config.path ? joinRemote(config.path) : "";
  const full = basePath ? joinRemote(basePath, remotePath) : remotePath;
  const tempDir = mkdtempSync(join(tmpdir(), `${APP_NAME_SLUG}-smb-stat-`));
  try {
    const localPath = join(tempDir, "file.bin");
    await client.getFile(full, localPath);
    const size = statSync(localPath).size;
    let md5: string | null = null;
    try {
      const md5Local = join(tempDir, ".md5");
      await client.getFile(full + MD5_SUFFIX, md5Local);
      md5 = readFileSync(md5Local, "utf8").trim();
    } catch {
      md5 = null;
    }
    return { size, md5 };
  } catch {
    return null;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function downloadSmb(
  config: SmbConfig,
  remotePath: string,
  destPath: string,
): Promise<void> {
  ensureSmbclientInstalled();
  const client = createSmbClient(config);
  const basePath = config.path ? joinRemote(config.path) : "";
  const full = basePath ? joinRemote(basePath, remotePath) : remotePath;
  await client.getFile(full, destPath);
}

/** Relative remote path under the destination path/prefix for an episode archive zip. */
export function archiveRemoteRelativePath(
  podcastId: string,
  episodeId: string,
  filename: string,
): string {
  return `harborfm-archives/${podcastId}/${episodeId}/${filename}`;
}

/** Relative remote path for a nondestructive episode backup zip. */
export function backupRemoteRelativePath(
  podcastId: string,
  episodeId: string,
  filename: string,
): string {
  return `harborfm-backups/${podcastId}/${episodeId}/${filename}`;
}

/** Directory prefix for episode backups (trailing slash). */
export function backupRemoteDirPrefix(
  podcastId: string,
  episodeId: string,
): string {
  return `harborfm-backups/${podcastId}/${episodeId}/`;
}

export type RemoteListedFile = {
  /** Path relative to destination root (same form as uploadOne remotePath). */
  remotePath: string;
  /** Basename only. */
  filename: string;
  size: number;
  lastModified: string | null;
};

function basenameRemote(remotePath: string): string {
  const parts = remotePath.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] || remotePath;
}

async function listFtp(
  config: FtpConfig,
  dirRemotePath: string,
): Promise<RemoteListedFile[]> {
  const client = new Client(FTP_CLIENT_TIMEOUT_MS, {
    allowSeparateTransferHost: false,
  });
  try {
    await client.access({
      host: config.host,
      port: config.port,
      user: config.username,
      password: config.password,
      secure: config.secure ? true : false,
    });
    const full = ftpRemoteFull(config.path, dirRemotePath.replace(/\/$/, ""));
    let entries;
    try {
      entries = await client.list(full || "/");
    } catch {
      return [];
    }
    const out: RemoteListedFile[] = [];
    for (const e of entries) {
      if (!e.isFile || !e.name || e.name.endsWith(MD5_SUFFIX)) continue;
      const remotePath = joinRemote(dirRemotePath.replace(/\/$/, ""), e.name);
      out.push({
        remotePath,
        filename: e.name,
        size: e.size,
        lastModified: e.modifiedAt ? e.modifiedAt.toISOString() : null,
      });
    }
    return out;
  } finally {
    client.close();
  }
}

async function listSftp(
  config: SftpConfig,
  dirRemotePath: string,
): Promise<RemoteListedFile[]> {
  const sftp = await sftpConnect(config);
  try {
    const full = config.path
      ? joinRemote(config.path, dirRemotePath.replace(/\/$/, ""))
      : dirRemotePath.replace(/\/$/, "");
    let entries;
    try {
      entries = await sftp.list(full || ".");
    } catch {
      return [];
    }
    const out: RemoteListedFile[] = [];
    for (const e of entries) {
      if (e.type !== "-" || !e.name || e.name.endsWith(MD5_SUFFIX)) continue;
      const remotePath = joinRemote(dirRemotePath.replace(/\/$/, ""), e.name);
      out.push({
        remotePath,
        filename: e.name,
        size: e.size,
        lastModified:
          typeof e.modifyTime === "number"
            ? new Date(e.modifyTime).toISOString()
            : null,
      });
    }
    return out;
  } finally {
    await sftp.end();
  }
}

async function listWebdav(
  config: WebdavConfig,
  dirRemotePath: string,
): Promise<RemoteListedFile[]> {
  const client = createClient(config.url.trim(), {
    username: config.username,
    password: config.password,
  });
  const base = config.path ? joinRemote(config.path) : "";
  const full = base
    ? joinRemote(base, dirRemotePath.replace(/\/$/, ""))
    : dirRemotePath.replace(/\/$/, "");
  let entries: Array<{
    basename?: string;
    filename?: string;
    type?: string;
    size?: number;
    lastmod?: string;
  }>;
  try {
    entries = (await client.getDirectoryContents(full || "/")) as typeof entries;
  } catch {
    return [];
  }
  const out: RemoteListedFile[] = [];
  for (const e of entries) {
    if (e.type !== "file") continue;
    const name = e.basename || basenameRemote(String(e.filename || ""));
    if (!name || name.endsWith(MD5_SUFFIX)) continue;
    const remotePath = joinRemote(dirRemotePath.replace(/\/$/, ""), name);
    out.push({
      remotePath,
      filename: name,
      size: typeof e.size === "number" ? e.size : 0,
      lastModified: e.lastmod ? new Date(e.lastmod).toISOString() : null,
    });
  }
  return out;
}

async function listIpfs(
  config: IpfsConfig,
  dirRemotePath: string,
): Promise<RemoteListedFile[]> {
  const client = createIpfsClient(config);
  const fullPath = ipfsMfsPath(config, dirRemotePath.replace(/\/$/, ""));
  const out: RemoteListedFile[] = [];
  try {
    for await (const entry of client.files.ls(fullPath)) {
      if (entry.type !== "file" || !entry.name || entry.name.endsWith(MD5_SUFFIX)) {
        continue;
      }
      const remotePath = joinRemote(dirRemotePath.replace(/\/$/, ""), entry.name);
      out.push({
        remotePath,
        filename: entry.name,
        size: entry.size,
        lastModified: null,
      });
    }
  } catch {
    return [];
  }
  return out;
}

async function listSmb(
  config: SmbConfig,
  dirRemotePath: string,
): Promise<RemoteListedFile[]> {
  ensureSmbclientInstalled();
  const client = createSmbClient(config);
  const basePath = config.path ? joinRemote(config.path) : "";
  const full = basePath
    ? joinRemote(basePath, dirRemotePath.replace(/\/$/, ""))
    : dirRemotePath.replace(/\/$/, "");
  let entries: Array<{
    name: string;
    type: string;
    size: number;
    modifyTime?: Date;
  }>;
  try {
    entries = await client.list(full || ".");
  } catch {
    return [];
  }
  const out: RemoteListedFile[] = [];
  for (const e of entries) {
    // samba-client uses type codes; files are typically "A" (archive attribute).
    if (!e.name || e.name.endsWith(MD5_SUFFIX)) continue;
    if (e.type === "D" || e.type === "d") continue;
    const remotePath = joinRemote(dirRemotePath.replace(/\/$/, ""), e.name);
    out.push({
      remotePath,
      filename: e.name,
      size: e.size,
      lastModified: e.modifyTime ? e.modifyTime.toISOString() : null,
    });
  }
  return out;
}

/**
 * List files directly under a remote directory prefix (e.g. harborfm-backups/.../).
 * Missing directories return []. Sidecar `.md5` files are omitted.
 */
export async function listDir(
  decrypted: ExportConfigDecrypted,
  dirRemotePath: string,
): Promise<RemoteListedFile[]> {
  const normalized = dirRemotePath.replace(/\/?$/, "/");
  switch (decrypted.mode) {
    case "S3": {
      const objects = await listObjectsUnderPrefix(
        decrypted.config as S3Config,
        normalized,
      );
      const out: RemoteListedFile[] = [];
      for (const obj of objects) {
        const filename = basenameRemote(obj.key);
        if (!filename || filename.endsWith(MD5_SUFFIX)) continue;
        // Only immediate children of the prefix.
        const rest = obj.key.startsWith(normalized)
          ? obj.key.slice(normalized.length)
          : filename;
        if (!rest || rest.includes("/")) continue;
        out.push({
          remotePath: obj.key,
          filename,
          size: obj.size,
          lastModified: obj.lastModified,
        });
      }
      return out;
    }
    case "FTP":
      return listFtp(decrypted.config, normalized);
    case "SFTP":
      return listSftp(decrypted.config, normalized);
    case "WebDAV":
      return listWebdav(decrypted.config, normalized);
    case "IPFS":
      return listIpfs(decrypted.config, normalized);
    case "SMB":
      return listSmb(decrypted.config, normalized);
    default:
      throw new Error(
        `Unsupported mode: ${(decrypted as { mode: string }).mode}`,
      );
  }
}

export async function uploadOne(
  decrypted: ExportConfigDecrypted,
  remotePath: string,
  body: Buffer,
  contentType = "application/zip",
): Promise<void> {
  switch (decrypted.mode) {
    case "S3":
      await uploadArchiveObject(
        decrypted.config as S3Config,
        remotePath,
        body,
        contentType,
      );
      return;
    case "FTP":
      await uploadFtp(decrypted.config, remotePath, body);
      return;
    case "SFTP":
      await uploadSftp(decrypted.config, remotePath, body);
      return;
    case "WebDAV":
      await uploadWebdav(decrypted.config, remotePath, body);
      return;
    case "IPFS":
      await uploadIpfs(decrypted.config, remotePath, body);
      return;
    case "SMB":
      await uploadSmb(decrypted.config, remotePath, body);
      return;
    default:
      throw new Error(
        `Unsupported mode: ${(decrypted as { mode: string }).mode}`,
      );
  }
}

export async function statOne(
  decrypted: ExportConfigDecrypted,
  remotePath: string,
  opts?: { requireDownloadable?: boolean },
): Promise<RemoteFileStat | null> {
  switch (decrypted.mode) {
    case "S3": {
      const st = await statObject(
        decrypted.config as S3Config,
        remotePath,
        opts,
      );
      if (!st) return null;
      return {
        size: st.size,
        md5: st.etag,
        storageClass: st.storageClass,
        restore: st.restore,
      };
    }
    case "FTP":
      return statFtp(decrypted.config, remotePath);
    case "SFTP":
      return statSftp(decrypted.config, remotePath);
    case "WebDAV":
      return statWebdav(decrypted.config, remotePath);
    case "IPFS":
      return statIpfs(decrypted.config, remotePath);
    case "SMB":
      return statSmb(decrypted.config, remotePath);
    default:
      throw new Error(
        `Unsupported mode: ${(decrypted as { mode: string }).mode}`,
      );
  }
}

export async function downloadOne(
  decrypted: ExportConfigDecrypted,
  remotePath: string,
  destPath: string,
): Promise<void> {
  switch (decrypted.mode) {
    case "S3":
      await downloadObjectToFile(
        decrypted.config as S3Config,
        remotePath,
        destPath,
      );
      return;
    case "FTP":
      await downloadFtp(decrypted.config, remotePath, destPath);
      return;
    case "SFTP":
      await downloadSftp(decrypted.config, remotePath, destPath);
      return;
    case "WebDAV":
      await downloadWebdav(decrypted.config, remotePath, destPath);
      return;
    case "IPFS":
      await downloadIpfs(decrypted.config, remotePath, destPath);
      return;
    case "SMB":
      await downloadSmb(decrypted.config, remotePath, destPath);
      return;
    default:
      throw new Error(
        `Unsupported mode: ${(decrypted as { mode: string }).mode}`,
      );
  }
}

/**
 * Verify an uploaded archive: remote size must match; when md5 sidecar/ETag is
 * available, check it too.
 */
export async function verifyUploadedArchive(
  decrypted: ExportConfigDecrypted,
  remotePath: string,
  localBytes: number,
  localMd5?: string | null,
): Promise<void> {
  const st = await statOne(decrypted, remotePath);
  if (!st) {
    throw new Error("Upload verification failed: remote file not found");
  }
  if (st.size !== localBytes) {
    throw new Error(
      `Upload verification failed: size mismatch (local ${localBytes}, remote ${st.size})`,
    );
  }
  if (localMd5 && st.md5 && decrypted.mode !== "S3") {
    if (st.md5.toLowerCase() !== localMd5.toLowerCase()) {
      throw new Error("Upload verification failed: checksum mismatch");
    }
  }
  if (localMd5 && st.md5 && decrypted.mode === "S3") {
    if (st.md5.toLowerCase() === localMd5.toLowerCase()) return;
    if (!st.md5.includes("-")) {
      throw new Error("Upload verification failed: ETag checksum mismatch");
    }
  }
}

export function modeOf(decrypted: ExportConfigDecrypted): ExportMode {
  return decrypted.mode;
}
