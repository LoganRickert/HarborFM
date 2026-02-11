import { createClient } from 'webdav';
import { readFileSync } from 'fs';
import { extname, join } from 'path';
import { getDataDir } from './paths.js';
import { assertPathUnder } from './paths.js';
import { EXT_DOT_TO_EXT } from '../utils/artwork.js';
import { md5Hex, MD5_SUFFIX } from '../utils/hash.js';
import type { DeployEpisode, DeployResult } from './deploy-types.js';

export interface WebdavConfig {
  url: string;
  username: string;
  password: string;
  path: string;
}

function joinPath(base: string, ...parts: string[]): string {
  const normalized = base.replace(/\/+$/, '');
  const joined = [normalized, ...parts].join('/').replace(/\/+/g, '/');
  return joined.replace(/^\//, '') || '';
}

const TEST_FILE = '.harborfm-test';

export async function testWebdavAccess(config: WebdavConfig): Promise<{ ok: boolean; error?: string }> {
  try {
    const client = createClient(config.url.trim(), {
      username: config.username,
      password: config.password,
    });
    // Test with PUT + DELETE (same as deploy). Some servers return 405 for MKCOL
    // but allow PUT, so we don't use createDirectory here.
    const basePath = config.path ? joinPath(config.path) : '';
    const testPath = basePath ? `${basePath}/${TEST_FILE}` : TEST_FILE;
    await client.putFileContents(testPath, Buffer.from(''));
    await client.deleteFile(testPath);
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

export async function deployPodcastToWebdav(
  config: WebdavConfig,
  _publicBaseUrl: string | null,
  rssXml: string,
  episodes: DeployEpisode[],
  artworkPath?: string | null
): Promise<DeployResult> {
  const errors: string[] = [];
  let uploaded = 0;
  let skipped = 0;
  const artworkBase = join(getDataDir(), 'artwork');

  const client = createClient(config.url.trim(), {
    username: config.username,
    password: config.password,
  });

  const basePath = config.path ? joinPath(config.path) : '';

  const ensureDir = async (dirPath: string) => {
    if (!dirPath) return;
    const parts = dirPath.split('/').filter(Boolean);
    let acc = '';
    for (const p of parts) {
      acc = acc ? `${acc}/${p}` : p;
      try {
        await client.createDirectory(acc);
      } catch {
        // may already exist
      }
    }
  };

  const upload = async (remotePath: string, body: Buffer) => {
    const full = basePath ? joinPath(basePath, remotePath) : remotePath;
    const hash = md5Hex(body);
    try {
      const existing = await client.getFileContents(full + MD5_SUFFIX);
      const raw = typeof existing === 'object' && existing != null && 'data' in existing ? (existing as { data: unknown }).data : existing;
      const buf = raw instanceof ArrayBuffer ? Buffer.from(raw) : typeof raw === 'string' ? Buffer.from(raw, 'utf8') : Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayLike<number>);
      if (buf.toString('utf8').trim() === hash) {
        skipped += 1;
        return;
      }
    } catch {
      // .md5 file does not exist or unreadable
    }
    const dir = full.includes('/') ? full.replace(/\/[^/]+$/, '') : '';
    await ensureDir(dir);
    await client.putFileContents(full, body);
    await client.putFileContents(full + MD5_SUFFIX, Buffer.from(hash, 'utf8'));
    uploaded += 1;
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
  }

  return { uploaded, skipped, errors };
}
