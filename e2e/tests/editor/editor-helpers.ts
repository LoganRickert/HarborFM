/// <reference types="node" />
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { Page } from '@playwright/test';
import {
  plantSegmentMultitrack,
  testDataMp3,
} from '../../lib/helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.E2E_PORT) || 3099;
export const API_BASE = `http://127.0.0.1:${PORT}/api`;
const E2E_DIR = join(__dirname, '../..');
const DATA_DIR = process.env.E2E_DATA_DIR || join(E2E_DIR, 'data');

export { PORT, E2E_DIR, DATA_DIR };

function getSetupToken(): string | null {
  const path = join(DATA_DIR, 'setup-token.txt');
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf8').trim();
}

export interface EditorFixture {
  episodeId: string;
  podcastId: string;
  segmentId: string;
  segmentName: string;
  csrf: string;
}

/** Login, create podcast/episode, upload a segment, plant multitrack takes. */
export async function createAdvancedEditorFixture(page: Page): Promise<EditorFixture> {
  const token = getSetupToken();
  if (token) {
    await page.request.post(`${API_BASE}/setup/complete?id=${encodeURIComponent(token)}`, {
      data: {
        email: 'admin@e2e.test',
        password: 'admin-password-123',
        hostname: `http://localhost:${PORT}`,
        registration_enabled: true,
        publicFeedsEnabled: true,
        import_pixabay_assets: false,
      },
    });
  }

  const loginRes = await page.request.post(`${API_BASE}/auth/login`, {
    data: { email: 'admin@e2e.test', password: 'admin-password-123' },
  });
  if (!loginRes.ok()) {
    throw new Error(`Login failed: ${loginRes.status()} ${await loginRes.text()}`);
  }

  const state = await page.context().storageState();
  const csrf = state.cookies.find((c) => c.name === 'harborfm_csrf')?.value;
  if (!csrf) throw new Error('No CSRF cookie after login');

  const podcastRes = await page.request.post(`${API_BASE}/podcasts`, {
    headers: { 'x-csrf-token': csrf },
    data: {
      title: 'E2E Editor Show',
      slug: `e2e-editor-${Date.now()}`,
      description: '',
    },
  });
  if (!podcastRes.ok()) throw new Error('Create podcast failed');
  const podcast = (await podcastRes.json()) as { id: string };

  const episodeRes = await page.request.post(`${API_BASE}/podcasts/${podcast.id}/episodes`, {
    headers: { 'x-csrf-token': csrf },
    data: {
      title: 'E2E Editor Episode',
      description: '',
      status: 'draft',
    },
  });
  if (!episodeRes.ok()) throw new Error('Create episode failed');
  const episode = (await episodeRes.json()) as { id: string };

  const buffer = readFileSync(testDataMp3());
  const segRes = await page.request.post(`${API_BASE}/episodes/${episode.id}/segments`, {
    headers: { 'x-csrf-token': csrf },
    multipart: {
      file: {
        name: 'audio.mp3',
        mimeType: 'audio/mpeg',
        buffer,
      },
    },
  });
  if (!segRes.ok()) {
    throw new Error(`Add segment failed: ${segRes.status()} ${await segRes.text()}`);
  }
  const seg = (await segRes.json()) as { id: string; durationSec?: number };
  const segmentName = 'Editor Intro';
  await page.request.patch(`${API_BASE}/episodes/${episode.id}/segments/${seg.id}`, {
    headers: { 'x-csrf-token': csrf },
    data: { name: segmentName },
  });

  plantSegmentMultitrack({
    podcastId: podcast.id,
    episodeId: episode.id,
    segmentId: seg.id,
    durationSec: seg.durationSec ?? 10,
  });

  return {
    episodeId: episode.id,
    podcastId: podcast.id,
    segmentId: seg.id,
    segmentName,
    csrf,
  };
}

export async function openAdvancedEditor(page: Page, episodeId: string): Promise<void> {
  await page.goto(`/episodes/${episodeId}`);
  await page.getByRole('button', { name: 'Edit segment timeline' }).click({ timeout: 25000 });
  await page.getByRole('button', { name: 'Advanced editor' }).click({ timeout: 15000 });
  await page.getByRole('heading', { name: /Advanced Editor:/i }).waitFor({ timeout: 15000 });
}
