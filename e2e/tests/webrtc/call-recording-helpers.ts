/// <reference types="node" />
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { Page } from '@playwright/test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.E2E_PORT) || 3099;
export const API_BASE = `http://127.0.0.1:${PORT}/api`;
const E2E_DIR = join(__dirname, '../..');
const DATA_DIR = process.env.E2E_DATA_DIR || join(E2E_DIR, 'data');

export { PORT, E2E_DIR, DATA_DIR };

export function getSetupToken(): string | null {
  const path = join(DATA_DIR, 'setup-token.txt');
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf8').trim();
}

/** Find multitrack dir (handles both segmentId and date_segmentId format). */
export function findMtDir(recordingsBase: string, segmentId: string): string | null {
  if (!existsSync(recordingsBase)) return null;
  const names = readdirSync(recordingsBase);
  const match = names.find((n) => n === segmentId || n.endsWith(`_${segmentId}`));
  return match ? join(recordingsBase, match) : null;
}

export interface CallRecordingFixture {
  episodeId: string;
  podcastId: string;
}

export async function createCallRecordingFixture(page: Page): Promise<CallRecordingFixture> {
  const token = getSetupToken();
  if (token) {
    await page.request.post(`${API_BASE}/setup/complete?id=${encodeURIComponent(token)}`, {
      data: {
        email: 'admin@e2e.test',
        password: 'admin-password-123',
        hostname: `http://localhost:${PORT}`,
        registration_enabled: true,
        public_feeds_enabled: true,
        import_pixabay_assets: false,
      },
    });
  }

  const loginRes = await page.request.post(`${API_BASE}/auth/login`, {
    data: { email: 'admin@e2e.test', password: 'admin-password-123' },
  });
  if (!loginRes.ok()) {
    const text = await loginRes.text();
    throw new Error(`Login failed: ${loginRes.status()} ${text}`);
  }

  const state = await page.context().storageState();
  const csrf = state.cookies.find((c) => c.name === 'harborfm_csrf')?.value;
  if (!csrf) throw new Error('No CSRF cookie after login');

  const podcastRes = await page.request.post(`${API_BASE}/podcasts`, {
    headers: { 'x-csrf-token': csrf },
    data: {
      title: 'E2E WebRTC Show',
      slug: `e2e-webrtc-${Date.now()}`,
      description: '',
    },
  });
  if (!podcastRes.ok()) throw new Error('Create podcast failed');
  const podcast = await podcastRes.json();

  const episodeRes = await page.request.post(`${API_BASE}/podcasts/${podcast.id}/episodes`, {
    headers: { 'x-csrf-token': csrf },
    data: {
      title: 'E2E WebRTC Episode',
      description: '',
      status: 'draft',
    },
  });
  if (!episodeRes.ok()) throw new Error('Create episode failed');
  const episode = await episodeRes.json();

  return { episodeId: episode.id, podcastId: podcast.id };
}

/** Create a library asset for soundboard tests. Uses fake-mic.wav from e2e assets. */
export async function createLibraryAsset(page: Page): Promise<string | null> {
  const wavPath = join(E2E_DIR, 'assets', 'fake-mic.wav');
  if (!existsSync(wavPath)) return null;

  const csrf = (await page.context().storageState()).cookies.find((c) => c.name === 'harborfm_csrf')?.value;
  if (!csrf) return null;

  const buffer = readFileSync(wavPath);
  const res = await page.request.post(`${API_BASE}/library`, {
    headers: { 'x-csrf-token': csrf },
    multipart: {
      file: {
        name: 'fake-mic.wav',
        mimeType: 'audio/wav',
        buffer,
      },
      name: 'E2E Soundboard Test',
    },
  });
  if (!res.ok()) return null;
  const data = await res.json();
  return (data as { id?: string }).id ?? null;
}
