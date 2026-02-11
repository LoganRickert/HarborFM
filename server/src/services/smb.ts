import { execSync } from 'child_process';
import SambaClient from 'samba-client';
import { readFileSync, writeFileSync, unlinkSync, mkdtempSync, rmSync } from 'fs';
import { join, extname } from 'path';
import { tmpdir } from 'os';
import { getDataDir } from './paths.js';
import { assertPathUnder } from './paths.js';
import { EXT_DOT_TO_EXT } from '../utils/artwork.js';
import { md5Hex, MD5_SUFFIX } from '../utils/hash.js';
import type { DeployEpisode, DeployResult } from './deploy-types.js';

export const SMB_CLIENT_REQUIRED =
  'smbclient is not installed. Install it with: sudo apt-get install smbclient (Debian/Ubuntu), or equivalent for your system.';

/**
 * Ensures the smbclient binary is available on PATH. Call before any SMB operation.
 * @throws Error if smbclient is not installed
 */
export function ensureSmbclientInstalled(): void {
  try {
    execSync('which smbclient', { stdio: 'pipe', encoding: 'utf8' });
    return;
  } catch {
    // which failed (e.g. Windows); try running smbclient
  }
  try {
    execSync('smbclient --version', { stdio: 'pipe', encoding: 'utf8' });
  } catch {
    throw new Error(SMB_CLIENT_REQUIRED);
  }
}

export interface SmbConfig {
  host: string;
  port?: number;
  share: string;
  username: string;
  password: string;
  domain: string;
  path: string;
}

function address(host: string, share: string): string {
  const h = host.replace(/^\/\/?|\\+|\/+$/g, '');
  const s = share.replace(/^\/\/?|\\+|\/+$/g, '');
  return `//${h}/${s}`;
}

function joinPath(base: string, ...parts: string[]): string {
  const normalized = base.replace(/\/+$/, '').replace(/\\+$/, '');
  const joined = [normalized, ...parts].join('/').replace(/\/+/g, '/');
  return joined.replace(/^\//, '') || '';
}

function createClient(config: SmbConfig): SambaClient {
  const opts: { address: string; username: string; password: string; domain?: string; port?: number } = {
    address: address(config.host, config.share),
    username: config.username,
    password: config.password,
    domain: config.domain || undefined,
  };
  if (config.port != null && config.port > 0) opts.port = config.port;
  return new SambaClient(opts);
}

export async function testSmbAccess(config: SmbConfig): Promise<{ ok: boolean; error?: string }> {
  ensureSmbclientInstalled();
  const client = createClient(config);
  try {
    await client.dir('*');
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}


export async function deployPodcastToSmb(
  config: SmbConfig,
  _publicBaseUrl: string | null,
  rssXml: string,
  episodes: DeployEpisode[],
  artworkPath?: string | null
): Promise<DeployResult> {
  ensureSmbclientInstalled();
  const errors: string[] = [];
  let uploaded = 0;
  let skipped = 0;
  const artworkBase = join(getDataDir(), 'artwork');
  const client = createClient(config);
  const basePath = config.path ? joinPath(config.path) : '';

  const tempDir = mkdtempSync(join(tmpdir(), 'harborfm-smb-'));
  const md5TempPath = join(tempDir, '.md5');

  const ensureDir = async (dirPath: string) => {
    if (!dirPath) return;
    const parts = dirPath.split('/').filter(Boolean);
    let acc = '';
    for (const p of parts) {
      acc = acc ? `${acc}/${p}` : p;
      try {
        await client.mkdir(acc, '');
      } catch {
        // may already exist
      }
    }
  };

  const upload = async (remotePath: string, body: Buffer) => {
    const full = basePath ? joinPath(basePath, remotePath) : remotePath;
    const hash = md5Hex(body);
    try {
      await client.getFile(full + MD5_SUFFIX, md5TempPath);
      const existingHash = readFileSync(md5TempPath, 'utf8').trim();
      if (existingHash === hash) {
        skipped += 1;
        try {
          unlinkSync(md5TempPath);
        } catch {
          // ignore
        }
        return;
      }
      try {
        unlinkSync(md5TempPath);
      } catch {
        // ignore
      }
    } catch {
      // .md5 file does not exist or get failed
    }
    const dir = full.includes('/') ? full.replace(/\/[^/]+$/, '') : '';
    if (dir) await ensureDir(dir);
    const localPath = join(tempDir, Buffer.from(remotePath).toString('hex'));
    writeFileSync(localPath, body);
    try {
      await client.sendFile(localPath, full);
      writeFileSync(md5TempPath, hash, 'utf8');
      await client.sendFile(md5TempPath, full + MD5_SUFFIX);
      uploaded += 1;
    } finally {
      try {
        unlinkSync(localPath);
      } catch {
        // ignore
      }
      try {
        unlinkSync(md5TempPath);
      } catch {
        // ignore
      }
    }
  };

  try {
    if (basePath) await ensureDir(basePath);

    const feedBody = Buffer.from(rssXml, 'utf8');
    await upload('feed.xml', feedBody);

    if (artworkPath) {
      try {
        const safePath = assertPathUnder(artworkPath, artworkBase);
        const body = readFileSync(safePath);
        const extFromPath = extname(safePath).toLowerCase();
        const ext = EXT_DOT_TO_EXT[extFromPath] ?? 'jpg';
        await upload(`cover.${ext}`, body);
      } catch (e) {
        errors.push(`Cover image: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    for (const ep of episodes) {
      if (ep.audio_final_path) {
        try {
          const body = readFileSync(ep.audio_final_path);
          const ext = extname(ep.audio_final_path || '') || '.mp3';
          await upload(`episodes/${ep.id}${ext}`, body);
        } catch (e) {
          errors.push(`Episode ${ep.id} audio: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      if (ep.artwork_path) {
        try {
          const safePath = assertPathUnder(ep.artwork_path, artworkBase);
          const body = readFileSync(safePath);
          const extFromPath = extname(safePath).toLowerCase();
          const ext = EXT_DOT_TO_EXT[extFromPath] ?? 'jpg';
          await upload(`episodes/${ep.id}.${ext}`, body);
        } catch (e) {
          errors.push(`Episode ${ep.id} artwork: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  } finally {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }

  return { uploaded, skipped, errors };
}
