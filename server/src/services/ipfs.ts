import { create } from 'kubo-rpc-client';
import { readFileSync } from 'fs';
import { extname, join } from 'path';
import { getDataDir } from './paths.js';
import { assertPathUnder } from './paths.js';
import { EXT_DOT_TO_EXT } from '../utils/artwork.js';
import { md5Hex, MD5_SUFFIX } from '../utils/hash.js';
import type { DeployEpisode, DeployResult } from './deploy-types.js';

export interface IpfsConfig {
  api_url: string;
  api_key?: string;
  /** Basic auth (e.g. for Caddy in front of Kubo). Used when api_key is not set. */
  username?: string;
  password?: string;
  path: string;
  /** Gateway base for enclosure URLs (e.g. https://ipfs.io/ipfs/). */
  gateway_url?: string | null;
}

function normalizeApiUrl(url: string): string {
  const u = url.trim().replace(/\/+$/, '');
  return u.endsWith('/api/v0') ? u : `${u}/api/v0`;
}

function createIpfsClient(config: IpfsConfig) {
  const url = normalizeApiUrl(config.api_url);
  const options: { url: string; headers?: Record<string, string> } = { url };
  if (config.api_key?.trim()) {
    options.headers = { authorization: `Bearer ${config.api_key.trim()}` };
  } else if (config.username != null && config.username !== '' && config.password != null) {
    const basic = Buffer.from(`${config.username}:${config.password}`, 'utf8').toString('base64');
    options.headers = { authorization: `Basic ${basic}` };
  }
  return create(options);
}

function formatIpfsTestError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const parts = [msg];
  if (err instanceof Error && err.cause) {
    const cause = err.cause as { status?: number; statusText?: string; body?: string };
    if (cause.status != null) parts.push(`HTTP ${cause.status}${cause.statusText ? ` ${cause.statusText}` : ''}`);
    if (typeof cause.body === 'string' && cause.body) parts.push(cause.body.slice(0, 500));
  }
  return parts.join(' — ');
}

export async function testIpfsAccess(config: IpfsConfig): Promise<{ ok: boolean; error?: string }> {
  const apiUrl = normalizeApiUrl(config.api_url);
  try {
    const client = createIpfsClient(config);
    await client.id();
    return { ok: true };
  } catch (err) {
    const msg = formatIpfsTestError(err);
    console.error('[IPFS test failed]', {
      api_url: apiUrl,
      has_api_key: Boolean(config.api_key?.trim()),
      has_basic_auth: Boolean(config.username && config.password != null),
      path: config.path || '(empty)',
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
      cause: err instanceof Error && err.cause ? String(err.cause) : undefined,
    });
    return { ok: false, error: msg };
  }
}

function joinPath(base: string, ...parts: string[]): string {
  const normalized = base.replace(/\/+$/, '');
  const joined = [normalized, ...parts].join('/').replace(/\/+/g, '/');
  return joined.replace(/^\//, '') || '';
}

/** Read existing file from MFS into a buffer. Returns null if path does not exist or read fails. */
async function readMfsFile(
  client: Awaited<ReturnType<typeof create>>,
  path: string
): Promise<Buffer | null> {
  try {
    const chunks: Uint8Array[] = [];
    for await (const chunk of client.files.read(path)) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } catch {
    return null;
  }
}

export async function deployPodcastToIpfs(
  config: IpfsConfig,
  _publicBaseUrl: string | null,
  rssXml: string,
  episodes: DeployEpisode[],
  artworkPath?: string | null,
  podcastId?: string
): Promise<DeployResult> {
  const errors: string[] = [];
  let uploaded = 0;
  let skipped = 0;
  const artworkBase = join(getDataDir(), 'artwork');
  const client = createIpfsClient(config);

  const basePath = config.path ? joinPath(config.path).replace(/^\//, '') : '';
  const mfsRoot = basePath ? `/${basePath}` : '/deploy';

  const writeFile = async (mfsPath: string, body: Buffer) => {
    const fullPath = mfsRoot + (mfsPath.startsWith('/') ? mfsPath : `/${mfsPath}`);
    const hash = md5Hex(body);
    const md5Path = fullPath + MD5_SUFFIX;
    const existingMd5 = await readMfsFile(client, md5Path);
    if (existingMd5 != null && existingMd5.toString('utf8').trim() === hash) {
      skipped += 1;
      return;
    }
    const dir = fullPath.replace(/\/[^/]+$/, '');
    if (dir && dir !== mfsRoot) {
      try {
        await client.files.mkdir(dir, { parents: true });
      } catch {
        // may already exist
      }
    }
    await client.files.write(fullPath, body, { create: true, truncate: true });
    await client.files.write(md5Path, Buffer.from(hash, 'utf8'), { create: true, truncate: true });
    uploaded += 1;
  };

  try {
    await client.files.mkdir(mfsRoot, { parents: true });

    if (artworkPath) {
      try {
        const safePath = assertPathUnder(artworkPath, artworkBase);
        const body = readFileSync(safePath);
        const extFromPath = extname(safePath).toLowerCase();
        const ext = EXT_DOT_TO_EXT[extFromPath] ?? 'jpg';
        await writeFile(`/cover.${ext}`, body);
      } catch (e) {
        errors.push(`Cover image: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    for (const ep of episodes) {
      if (ep.audio_final_path) {
        try {
          const body = readFileSync(ep.audio_final_path);
          const ext = extname(ep.audio_final_path || '') || '.mp3';
          await writeFile(`/episodes/${ep.id}${ext}`, body);
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
          await writeFile(`/episodes/${ep.id}.${ext}`, body);
        } catch (e) {
          errors.push(`Episode ${ep.id} artwork: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }

    const stat = await client.files.stat(mfsRoot);
    const dirCid = stat.cid.toString();
    const gatewayBase = (config.gateway_url ?? 'https://ipfs.io/ipfs/').toString().trim().replace(/\/+$/, '');
    const publicBaseUrl = `${gatewayBase}/${dirCid}/`;

    if (!podcastId) {
      errors.push('IPFS deploy requires podcastId to generate feed with correct URLs');
    } else {
      const { generateRss } = await import('./rss.js');
      const xml = generateRss(podcastId, publicBaseUrl);
      const feedBody = Buffer.from(xml, 'utf8');
      await writeFile('/feed.xml', feedBody);
    }

    const finalStat = await client.files.stat(mfsRoot);
    await client.pin.add(finalStat.cid, { recursive: true });
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  return { uploaded, skipped, errors };
}
