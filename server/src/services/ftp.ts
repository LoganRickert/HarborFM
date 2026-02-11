import { Readable, Writable } from 'stream';
import { Client } from 'basic-ftp';
import { readFileSync } from 'fs';
import { extname, join } from 'path';
import { getDataDir } from './paths.js';
import { assertPathUnder } from './paths.js';
import { EXT_DOT_TO_EXT } from '../utils/artwork.js';
import { md5Hex, MD5_SUFFIX } from '../utils/hash.js';
import type { DeployEpisode, DeployResult } from './deploy-types.js';

export interface FtpConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  path: string;
  secure: boolean;
}

function joinPath(base: string, ...parts: string[]): string {
  const normalized = base.replace(/\/+$/, '');
  const joined = [normalized, ...parts].join('/').replace(/\/+/g, '/');
  return joined.replace(/^\//, '') || '';
}

/** Remote path for upload: absolute (leading /) so CWD doesn't double path segments. */
function remoteFull(basePath: string, remotePath: string): string {
  const combined = basePath ? joinPath(basePath, remotePath) : remotePath;
  return combined ? `/${combined}` : '/';
}

const FTP_CLIENT_OPTIONS = {
  allowSeparateTransferHost: false, // use same host as control for data connections (fixes passive mode to wrong IP)
} as const;

export async function testFtpAccess(config: FtpConfig): Promise<{ ok: boolean; error?: string }> {
  const client = new Client(60_000, FTP_CLIENT_OPTIONS);
  try {
    await client.access({
      host: config.host,
      port: config.port,
      user: config.username,
      password: config.password,
      secure: config.secure ? true : false,
    });
    if (config.path) {
      await client.ensureDir(config.path);
    }
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  } finally {
    client.close();
  }
}

/** Download remote file to buffer. Returns null if file does not exist or read fails. */
async function downloadFtpToBuffer(
  client: Client,
  remotePath: string
): Promise<Buffer | null> {
  try {
    const chunks: Buffer[] = [];
    const writable = new Writable({
      write(chunk: Buffer, _enc, cb) {
        chunks.push(Buffer.from(chunk));
        cb();
      },
    });
    await client.downloadTo(writable, remotePath);
    return Buffer.concat(chunks);
  } catch {
    return null;
  }
}

export async function deployPodcastToFtp(
  config: FtpConfig,
  _publicBaseUrl: string | null,
  rssXml: string,
  episodes: DeployEpisode[],
  artworkPath?: string | null
): Promise<DeployResult> {
  const errors: string[] = [];
  let uploaded = 0;
  let skipped = 0;
  const artworkBase = join(getDataDir(), 'artwork');
  const client = new Client(120_000, FTP_CLIENT_OPTIONS);

  try {
    await client.access({
      host: config.host,
      port: config.port,
      user: config.username,
      password: config.password,
      secure: config.secure ? true : false,
    });

    const basePath = config.path ? joinPath(config.path) : '';
    const ensuredDirs = new Set<string>();

    const upload = async (remotePath: string, body: Buffer, _contentType?: string) => {
      const full = remoteFull(basePath, remotePath);
      const hash = md5Hex(body);
      const md5Buf = await downloadFtpToBuffer(client, full + MD5_SUFFIX);
      if (md5Buf != null && md5Buf.toString('utf8').trim() === hash) {
        skipped += 1;
        return;
      }
      const dir = full.slice(0, full.lastIndexOf('/')) || '';
      if (dir && !ensuredDirs.has(dir)) {
        await client.ensureDir(dir);
        ensuredDirs.add(dir);
      }
      await client.uploadFrom(Readable.from(body), full);
      await client.uploadFrom(Readable.from(Buffer.from(hash, 'utf8')), full + MD5_SUFFIX);
      uploaded += 1;
    };

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
    client.close();
  }

  return { uploaded, skipped, errors };
}
