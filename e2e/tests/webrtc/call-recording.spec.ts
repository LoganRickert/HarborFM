/// <reference types="node" />
import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.E2E_PORT) || 3099;
const API_BASE = `http://127.0.0.1:${PORT}/api`;
const E2E_DIR = join(__dirname, '../..');
const DATA_DIR = process.env.E2E_DATA_DIR || join(E2E_DIR, 'data');

let episodeId: string;

function getSetupToken(): string | null {
  const path = join(DATA_DIR, 'setup-token.txt');
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf8').trim();
}

test.describe('Call recording golden path', () => {
  test.beforeEach(async ({ page }) => {
    const token = getSetupToken();
    if (token) {
      console.log('[call-recording] Completing setup...');
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

    console.log('[call-recording] Logging in...');
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

    console.log('[call-recording] Creating podcast...');
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
    console.log('[call-recording] Creating episode...');

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
    episodeId = episode.id;
    console.log('[call-recording] Created episode', episodeId);
  });

  test('records segment and persists via API', async ({ page }) => {
    test.setTimeout(60000);
    console.log('[call-recording] Navigating to episode editor...');
    await page.goto(`/episodes/${episodeId}`);

    console.log('[call-recording] Starting group call...');
    await page.getByRole('button', { name: /start group call/i }).click();

    const recordBtn = page.getByRole('button', { name: /record segment/i });
    await expect(recordBtn).toBeVisible({ timeout: 10000 });
    // Producer may need time to register. Click Record; retry if we get "No audio producer".
    let recordingStarted = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.waitForTimeout(attempt === 0 ? 8000 : 5000);
      await recordBtn.click();
      await page.waitForTimeout(3000);
      const stopVisible = await page.getByRole('button', { name: /stop recording/i }).isVisible();
      const errorVisible = await page.getByText(/failed to start recording|no audio producer/i).isVisible();
      if (stopVisible && !errorVisible) {
        recordingStarted = true;
        break;
      }
      if (errorVisible) console.log(`[call-recording] Attempt ${attempt + 1}: got error, retrying...`);
    }
    if (!recordingStarted) throw new Error('Recording never started after 3 attempts');
    await expect(page.getByRole('button', { name: /stop recording/i })).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(2500);
    console.log('[call-recording] Stopping recording...');
    await page.getByRole('button', { name: /stop recording/i }).click();

    await expect(
      page.getByText(/recording stopped successfully/i)
    ).toBeVisible({ timeout: 15000 });
    console.log('[call-recording] Recording stopped, polling for segment...');

    // Poll for segment - callback from webrtc can take a few seconds
    let recorded: { duration_sec?: number } | undefined;
    for (let i = 0; i < 30; i++) {
      await page.waitForTimeout(500);
      const segmentsRes = await page.request.get(`${API_BASE}/episodes/${episodeId}/segments`);
      expect(segmentsRes.ok()).toBeTruthy();
      const { segments } = await segmentsRes.json();
      expect(Array.isArray(segments)).toBeTruthy();
      if (i % 5 === 0 || segments.length > 0) {
        console.log(`[call-recording] Poll ${i + 1}/30: segments count=${segments.length}`);
      }
      recorded = segments.find(
        (s: { duration_sec?: number }) => s.duration_sec != null
      );
      if (recorded) {
        console.log('[call-recording] Found segment with duration_sec=', recorded.duration_sec);
        break;
      }
    }
    expect(recorded).toBeDefined();
    expect(recorded!.duration_sec).toBeGreaterThanOrEqual(0);
  });

  test('End call', async ({ page }) => {
    await page.goto(`/episodes/${episodeId}`);
    await page.getByRole('button', { name: /start group call/i }).click();
    await expect(page.getByRole('button', { name: /record segment/i })).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: /end call/i }).click();
    await expect(page.getByRole('region', { name: /group call/i })).toHaveCount(0);
  });

  test('Copy join link', async ({ page }) => {
    // Clipboard is often blocked in automation; stub so the UI still shows "Copied"
    await page.addInitScript(() => {
      if (navigator.clipboard) {
        navigator.clipboard.writeText = () => Promise.resolve();
      }
    });
    await page.goto(`/episodes/${episodeId}`);
    await page.getByRole('button', { name: /start group call/i }).click();
    const panel = page.getByRole('region', { name: /group call/i });
    await expect(panel).toBeVisible({ timeout: 10000 });
    await panel.getByRole('button', { name: /copy join link/i }).click();
    await expect(panel.getByRole('button', { name: /copied/i })).toBeVisible({ timeout: 5000 });
  });

  test('Host sees self in participants', async ({ page }) => {
    await page.goto(`/episodes/${episodeId}`);
    await page.getByRole('button', { name: /start group call/i }).click();
    await expect(page.getByRole('button', { name: /record segment/i })).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(/Participants \(1\)/)).toBeVisible();
    await expect(page.getByText(/\(Host\)/)).toBeVisible();
  });

  test('Guest joins and host sees them', async ({ page, context }) => {
    test.setTimeout(45000);
    const baseURL = `http://127.0.0.1:${PORT}`;
    await page.goto(`/episodes/${episodeId}`);
    await page.getByRole('button', { name: /start group call/i }).click();
    await expect(page.getByRole('button', { name: /record segment/i })).toBeVisible({ timeout: 20000 });

    const joinUrlRaw = await page.getByRole('textbox', { name: 'Join link' }).inputValue();
    const joinUrl = joinUrlRaw.startsWith('/') ? `${baseURL}${joinUrlRaw}` : joinUrlRaw;

    const browser = context.browser()!;
    const guestContext = await browser.newContext({
      baseURL,
      permissions: ['microphone'],
    });
    const guestPage = await guestContext.newPage();
    try {
      await guestPage.goto(joinUrl);
      await guestPage.getByLabel(/your name/i).fill('E2E Guest');
      await guestPage.getByRole('button', { name: /join call/i }).click();
      await expect(guestPage.getByText(/you're in the call/i)).toBeVisible({ timeout: 15000 });

      await expect(page.getByText(/Participants \(2\)/)).toBeVisible({ timeout: 10000 });
    } finally {
      await guestContext.close();
    }
  });
});
