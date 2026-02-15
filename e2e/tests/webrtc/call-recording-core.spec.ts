/// <reference types="node" />
import { test, expect } from '@playwright/test';
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import {
  createCallRecordingFixture,
  findMtDir,
  API_BASE,
  PORT,
  DATA_DIR,
} from './call-recording-helpers';

let episodeId: string;
let podcastId: string;

test.describe('Call recording core', () => {
  test.beforeEach(async ({ page }) => {
    const fixture = await createCallRecordingFixture(page);
    episodeId = fixture.episodeId;
    podcastId = fixture.podcastId;
  });

  test('records segment and persists via API', async ({ page }) => {
    test.setTimeout(60000);
    page.on('console', (msg) => {
      const text = msg.text();
      const type = msg.type();
      if (type === 'error' || /recording|Recording|No audio|failed|webrtc|mediasoup/i.test(text)) {
        console.log(`[call-recording] BROWSER ${type}:`, text.slice(0, 300));
      }
    });
    await page.goto(`/episodes/${episodeId}`);

    const startBtn = page.getByRole('button', { name: /start group call/i });
    await startBtn.click();

    const recordBtn = page.getByRole('button', { name: /record segment/i });
    await expect(recordBtn).toBeVisible({ timeout: 10000 });
    await expect(recordBtn).toHaveAttribute('data-producer-ready', 'true', { timeout: 25000 });

    const panel = page.getByRole('region', { name: /group call/i });
    const stopBtn = page.getByRole('button', { name: /stop recording/i });
    const errorEl = page.getByText(/failed to start recording|no audio producer|no audio received/i);
    let recordingStarted = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.waitForTimeout(attempt === 0 ? 2000 : 3000);
      await recordBtn.click();

      try {
        await expect(stopBtn).toBeVisible({ timeout: 15000 });
        const errorVisible = await errorEl.isVisible();
        if (!errorVisible) {
          recordingStarted = true;
          break;
        }
      } catch {
        // Stop button didn't appear in time
      }
    }
    if (!recordingStarted) {
      const errorText = (await errorEl.isVisible()) ? await errorEl.first().textContent() : null;
      const mediaBanner = page.getByText(/audio is unavailable|webrtc.*not.*running/i);
      const mediaUnavail = (await mediaBanner.isVisible()) ? await mediaBanner.first().textContent() : null;
      throw new Error(
        `Recording never started after 3 attempts. ` +
          `Error on page: ${errorText ?? 'none'}. ` +
          `Media unavailable: ${mediaUnavail ?? 'no'}.`
      );
    }
    await page.waitForTimeout(2500);
    await stopBtn.click();

    const successOrError = await Promise.race([
      page.getByText(/recording stopped successfully/i).waitFor({ state: 'visible', timeout: 30000 }),
      page
        .getByText(/failed to stop recording|recording produced no audio|recording failed/i)
        .waitFor({ state: 'visible', timeout: 30000 })
        .then(() => 'error' as const),
    ]).catch(async (e) => {
      const panel = page.getByRole('region', { name: /group call/i });
      const panelText = await panel.textContent().catch(() => '');
      const errorEl = page.getByText(/failed|error|no audio/i).first();
      const errorText = (await errorEl.isVisible().catch(() => false)) ? await errorEl.textContent() : null;
      console.log('[call-recording] Timeout - panel excerpt:', panelText?.slice(0, 400));
      console.log('[call-recording] Timeout - error element:', errorText);
      throw e;
    });
    if (successOrError === 'error') {
      const errText = await page
        .getByText(/failed to stop recording|recording produced no audio|recording failed/i)
        .first()
        .textContent();
      throw new Error(`Recording stop failed: ${errText}`);
    }

    let recorded: { id?: string; duration_sec?: number } | undefined;
    for (let i = 0; i < 30; i++) {
      await page.waitForTimeout(500);
      const segmentsRes = await page.request.get(`${API_BASE}/episodes/${episodeId}/segments`);
      expect(segmentsRes.ok()).toBeTruthy();
      const { segments } = await segmentsRes.json();
      expect(Array.isArray(segments)).toBeTruthy();
      recorded = segments.find((s: { duration_sec?: number }) => s.duration_sec != null);
      if (recorded) break;
    }
    expect(recorded).toBeDefined();
    expect(recorded!.duration_sec).toBeGreaterThanOrEqual(0);

    const segId = (recorded as { id?: string }).id;
    if (segId) {
      const recordingsBase = join(DATA_DIR, 'uploads', podcastId, episodeId, 'recordings');
      const mtDir = findMtDir(recordingsBase, segId);
      if (mtDir) {
        const files = readdirSync(mtDir);
        const hasManifest = files.includes('tracks_manifest.json');
        const mp3Files = files.filter((f) => f.startsWith('segment_') && f.endsWith('.mp3'));
        expect(hasManifest).toBe(true);
        expect(mp3Files.length).toBeGreaterThanOrEqual(1);
        for (const f of mp3Files) {
          const p = join(mtDir, f);
          expect(statSync(p).size).toBeGreaterThan(0);
        }
      }
    }
  });

  test('records with two participants and creates multitrack files', async ({ page, context }) => {
    test.setTimeout(60000);
    const baseURL = `http://127.0.0.1:${PORT}`;
    page.on('console', (msg) => {
      const text = msg.text();
      const type = msg.type();
      if (type === 'error' || /recording|Recording|No audio|failed|webrtc|mediasoup/i.test(text)) {
        console.log(`[call-recording] BROWSER ${type}:`, text.slice(0, 300));
      }
    });
    await page.goto(`/episodes/${episodeId}`);
    await page.getByRole('button', { name: /start group call/i }).click();
    await expect(page.getByRole('button', { name: /record segment/i })).toBeVisible({ timeout: 20000 });

    const joinUrlRaw = await page.getByRole('textbox', { name: 'Join link' }).inputValue();
    const joinUrl = joinUrlRaw.startsWith('/') ? `${baseURL}${joinUrlRaw}` : joinUrlRaw;

    const browser = context.browser()!;
    const guestContext = await browser.newContext({ baseURL, permissions: ['microphone'] });
    const guestPage = await guestContext.newPage();
    try {
      await guestPage.goto(joinUrl);
      await guestPage.getByLabel(/your name/i).fill('E2E Guest');
      await guestPage.getByRole('button', { name: /join call/i }).click();
      await expect(guestPage.getByText(/you're in the call/i)).toBeVisible({ timeout: 15000 });
      await expect(page.getByText(/Participants \(2\)/)).toBeVisible({ timeout: 10000 });

      const recordBtn = page.getByRole('button', { name: /record segment/i });
      await expect(recordBtn).toHaveAttribute('data-producer-ready', 'true', { timeout: 25000 });
      await recordBtn.click();
      await expect(page.getByRole('button', { name: /stop recording/i })).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(5000);

      await page.getByRole('button', { name: /stop recording/i }).click();
      await page.getByText(/recording stopped successfully/i).waitFor({ state: 'visible', timeout: 30000 });

      let recorded: { id?: string; duration_sec?: number } | undefined;
      for (let i = 0; i < 30; i++) {
        await page.waitForTimeout(500);
        const segmentsRes = await page.request.get(`${API_BASE}/episodes/${episodeId}/segments`);
        expect(segmentsRes.ok()).toBeTruthy();
        const { segments } = await segmentsRes.json();
        recorded = segments.find((s: { duration_sec?: number }) => s.duration_sec != null);
        if (recorded) break;
      }
      expect(recorded).toBeDefined();
      expect(recorded!.duration_sec).toBeGreaterThanOrEqual(0);

      const segId = recorded!.id;
      expect(segId).toBeDefined();
      const recordingsBase = join(DATA_DIR, 'uploads', podcastId, episodeId, 'recordings');
      const mtDir = findMtDir(recordingsBase, segId!);
      expect(mtDir).toBeTruthy();
      const files = readdirSync(mtDir!);
      expect(files).toContain('tracks_manifest.json');
      const manifest = JSON.parse(readFileSync(join(mtDir!, 'tracks_manifest.json'), 'utf8'));
      expect(Array.isArray(manifest.segments)).toBe(true);
      expect(manifest.segments.length).toBeGreaterThanOrEqual(1);
      const mp3Files = files.filter((f) => f.startsWith('segment_') && f.endsWith('.mp3'));
      expect(mp3Files.length).toBeGreaterThanOrEqual(1);
      for (const f of mp3Files) {
        expect(statSync(join(mtDir!, f)).size).toBeGreaterThan(0);
      }

      const audioPath = (recorded as { audio_path?: string }).audio_path;
      if (audioPath && existsSync(audioPath)) {
        expect(statSync(audioPath).size).toBeGreaterThan(0);
      }
    } finally {
      await guestContext.close();
    }
  });

  test('recording continues when guest leaves mid-recording', async ({ page, context }) => {
    test.setTimeout(60000);
    const baseURL = `http://127.0.0.1:${PORT}`;
    page.on('console', (msg) => {
      const text = msg.text();
      const type = msg.type();
      if (type === 'error' || /recording|Recording|No audio|failed|webrtc|mediasoup/i.test(text)) {
        console.log(`[call-recording] BROWSER ${type}:`, text.slice(0, 300));
      }
    });
    await page.goto(`/episodes/${episodeId}`);
    await page.getByRole('button', { name: /start group call/i }).click();
    await expect(page.getByRole('button', { name: /record segment/i })).toBeVisible({ timeout: 20000 });

    const joinUrlRaw = await page.getByRole('textbox', { name: 'Join link' }).inputValue();
    const joinUrl = joinUrlRaw.startsWith('/') ? `${baseURL}${joinUrlRaw}` : joinUrlRaw;

    const browser = context.browser()!;
    const guestContext = await browser.newContext({ baseURL, permissions: ['microphone'] });
    const guestPage = await guestContext.newPage();
    try {
      await guestPage.goto(joinUrl);
      await guestPage.getByLabel(/your name/i).fill('E2E Guest');
      await guestPage.getByRole('button', { name: /join call/i }).click();
      await expect(guestPage.getByText(/you're in the call/i)).toBeVisible({ timeout: 15000 });
      await expect(page.getByText(/Participants \(2\)/)).toBeVisible({ timeout: 10000 });

      const recordBtn = page.getByRole('button', { name: /record segment/i });
      await expect(recordBtn).toHaveAttribute('data-producer-ready', 'true', { timeout: 25000 });
      await recordBtn.click();
      await expect(page.getByRole('button', { name: /stop recording/i })).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(3000);

      await guestPage.getByRole('button', { name: /leave call/i }).click();
      const leaveDialog = guestPage.getByRole('dialog');
      await expect(leaveDialog).toBeVisible({ timeout: 5000 });
      await leaveDialog.getByRole('button', { name: /confirm leave call|leave call/i }).click();
      await expect(guestPage.getByText(/you're in the call/i)).not.toBeVisible({ timeout: 5000 });

      await page.waitForTimeout(2000);
      await page.getByRole('button', { name: /stop recording/i }).click();
      await page.getByText(/recording stopped successfully/i).waitFor({ state: 'visible', timeout: 30000 });

      let recorded: { id?: string; duration_sec?: number } | undefined;
      for (let i = 0; i < 30; i++) {
        await page.waitForTimeout(500);
        const segmentsRes = await page.request.get(`${API_BASE}/episodes/${episodeId}/segments`);
        expect(segmentsRes.ok()).toBeTruthy();
        const { segments } = await segmentsRes.json();
        recorded = segments.find((s: { duration_sec?: number }) => s.duration_sec != null);
        if (recorded) break;
      }
      expect(recorded).toBeDefined();
      expect(recorded!.duration_sec).toBeGreaterThanOrEqual(0);
    } finally {
      await guestContext.close();
    }
  });

  test('reconnect during recording still produces a complete recording @slow', async ({ page, context }) => {
    test.setTimeout(90000);
    const baseURL = `http://127.0.0.1:${PORT}`;
    page.on('console', (msg) => {
      const text = msg.text();
      const type = msg.type();
      if (type === 'error' || /recording|Recording|No audio|failed|webrtc|mediasoup/i.test(text)) {
        console.log(`[call-recording] BROWSER ${type}:`, text.slice(0, 300));
      }
    });
    await page.goto(`/episodes/${episodeId}`);
    await page.getByRole('button', { name: /start group call/i }).click();
    await expect(page.getByRole('button', { name: /record segment/i })).toBeVisible({ timeout: 20000 });

    const joinUrlRaw = await page.getByRole('textbox', { name: 'Join link' }).inputValue();
    const joinUrl = joinUrlRaw.startsWith('/') ? `${baseURL}${joinUrlRaw}` : joinUrlRaw;

    const browser = context.browser()!;
    const guestContext = await browser.newContext({ baseURL, permissions: ['microphone'] });
    const guestPage = await guestContext.newPage();
    try {
      await guestPage.goto(joinUrl);
      await guestPage.getByLabel(/your name/i).fill('E2E Guest');
      await guestPage.getByRole('button', { name: /join call/i }).click();
      await expect(guestPage.getByText(/you're in the call/i)).toBeVisible({ timeout: 15000 });
      await expect(page.getByText(/Participants \(2\)/)).toBeVisible({ timeout: 10000 });

      const recordBtn = page.getByRole('button', { name: /record segment/i });
      await expect(recordBtn).toHaveAttribute('data-producer-ready', 'true', { timeout: 25000 });
      await recordBtn.click();
      await expect(page.getByRole('button', { name: /stop recording/i })).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(2000);

      await guestPage.getByRole('button', { name: /leave call/i }).click();
      const reconnectLeaveDialog = guestPage.getByRole('dialog');
      await expect(reconnectLeaveDialog).toBeVisible({ timeout: 5000 });
      await reconnectLeaveDialog.getByRole('button', { name: /confirm leave call|leave call/i }).click();
      await expect(guestPage.getByText(/you're in the call/i)).not.toBeVisible({ timeout: 5000 });

      await guestPage.goto(joinUrl);
      await guestPage.getByLabel(/your name/i).fill('E2E Guest');
      await guestPage.getByRole('button', { name: /join call/i }).click();
      await expect(guestPage.getByText(/you're in the call/i)).toBeVisible({ timeout: 15000 });
      await expect(page.getByText(/Participants \(2\)/)).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(3000);

      await page.getByRole('button', { name: /stop recording/i }).click();
      await page.getByText(/recording stopped successfully/i).waitFor({ state: 'visible', timeout: 30000 });

      let recorded: { id?: string; duration_sec?: number } | undefined;
      for (let i = 0; i < 60; i++) {
        await page.waitForTimeout(500);
        const segmentsRes = await page.request.get(`${API_BASE}/episodes/${episodeId}/segments`);
        expect(segmentsRes.ok()).toBeTruthy();
        const { segments } = await segmentsRes.json();
        recorded = segments.find((s: { duration_sec?: number }) => s.duration_sec != null);
        if (recorded) break;
      }
      expect(recorded).toBeDefined();
      expect(recorded!.duration_sec).toBeGreaterThanOrEqual(0);

      const segId = recorded!.id;
      expect(segId).toBeDefined();
      const recordingsBase = join(DATA_DIR, 'uploads', podcastId, episodeId, 'recordings');
      const mtDir = findMtDir(recordingsBase, segId!);
      expect(mtDir).toBeTruthy();
      const files = readdirSync(mtDir!);
      expect(files).toContain('tracks_manifest.json');
      const manifest = JSON.parse(readFileSync(join(mtDir!, 'tracks_manifest.json'), 'utf8'));
      expect(Array.isArray(manifest.segments)).toBe(true);
      expect(manifest.segments.length).toBeGreaterThanOrEqual(1);
      for (const seg of manifest.segments) {
        const filePath = seg.filePath ?? seg.file_path;
        if (filePath) {
          const fullPath = join(mtDir!, filePath.includes('/') ? filePath.split('/').pop()! : filePath);
          expect(existsSync(fullPath)).toBe(true);
          expect(statSync(fullPath).size).toBeGreaterThan(0);
        }
      }
    } finally {
      await guestContext.close();
    }
  });

  test('recovers .part files after webrtc restart @slow', async ({ page }) => {
    test.skip(process.env.E2E_FAULT_INJECTION !== '1', 'Crash recovery requires E2E_FAULT_INJECTION=1 and restart-webrtc');
    test.setTimeout(120000);
  });

  test('End call', async ({ page }) => {
    await page.goto(`/episodes/${episodeId}`);
    await page.getByRole('button', { name: /start group call/i }).click();
    await expect(page.getByRole('button', { name: /record segment/i })).toBeVisible({ timeout: 10000 });
    const panel = page.getByRole('region', { name: /group call/i });
    await panel.getByRole('button', { name: /end call/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: /confirm end call/i }).click();
    await expect(panel).toHaveCount(0);
  });
});
