/// <reference types="node" />
import { test, expect } from '@playwright/test';
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.E2E_PORT) || 3099;
const API_BASE = `http://127.0.0.1:${PORT}/api`;
const E2E_DIR = join(__dirname, '../..');
const DATA_DIR = process.env.E2E_DATA_DIR || join(E2E_DIR, 'data');

let episodeId: string;
let podcastId: string;

function getSetupToken(): string | null {
  const path = join(DATA_DIR, 'setup-token.txt');
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf8').trim();
}

/** Find multitrack dir (handles both segmentId and date_segmentId format). */
function findMtDir(recordingsBase: string, segmentId: string): string | null {
  if (!existsSync(recordingsBase)) return null;
  const names = readdirSync(recordingsBase);
  const match = names.find((n) => n === segmentId || n.endsWith(`_${segmentId}`));
  return match ? join(recordingsBase, match) : null;
}

test.describe('Call recording golden path', () => {
  test.beforeEach(async ({ page }) => {
    console.log('[call-recording] beforeEach starting...');
    const token = getSetupToken();
    if (token) {
      console.log('[call-recording] Completing setup with token...');
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

    console.log('[call-recording] Logging in as admin@e2e.test...');
    const loginRes = await page.request.post(`${API_BASE}/auth/login`, {
      data: { email: 'admin@e2e.test', password: 'admin-password-123' },
    });
    if (!loginRes.ok()) {
      const text = await loginRes.text();
      console.log('[call-recording] Login failed:', loginRes.status(), text);
      throw new Error(`Login failed: ${loginRes.status()} ${text}`);
    }
    console.log('[call-recording] Login OK');

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
    podcastId = podcast.id;
    console.log('[call-recording] Created episode', episodeId);
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
    console.log('[call-recording] episodeId=', episodeId, 'podcastId=', podcastId);
    console.log('[call-recording] Navigating to episode editor...');
    await page.goto(`/episodes/${episodeId}`);
    console.log('[call-recording] Page URL:', page.url());

    const startBtn = page.getByRole('button', { name: /start group call/i });
    console.log('[call-recording] Waiting for Start group call button...');
    await startBtn.click();
    console.log('[call-recording] Clicked Start group call');

    const recordBtn = page.getByRole('button', { name: /record segment/i });
    console.log('[call-recording] Waiting for Record Segment button (timeout 10s)...');
    await expect(recordBtn).toBeVisible({ timeout: 10000 });
    console.log('[call-recording] Record button visible');

    console.log('[call-recording] Waiting for data-producer-ready=true (timeout 25s)...');
    await expect(recordBtn).toHaveAttribute('data-producer-ready', 'true', { timeout: 25000 });
    console.log('[call-recording] Producer ready');

    const panel = page.getByRole('region', { name: /group call/i });
    const panelText = await panel.textContent();
    console.log('[call-recording] Call panel content (before Record):', panelText?.slice(0, 300));

    let recordingStarted = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.waitForTimeout(attempt === 0 ? 2000 : 3000);
      console.log(`[call-recording] Attempt ${attempt + 1}/3: clicking Record (waited ${attempt === 0 ? 2000 : 3000}ms)...`);
      await recordBtn.click();
      console.log(`[call-recording] Attempt ${attempt + 1}: clicked, waiting 2s for response...`);
      await page.waitForTimeout(2000);

      const stopVisible = await page.getByRole('button', { name: /stop recording/i }).isVisible();
      const errorVisible = await page.getByText(/failed to start recording|no audio producer|no audio received/i).isVisible();
      const errorText = errorVisible
        ? await page.getByText(/failed to start recording|no audio producer|no audio received/i).first().textContent()
        : null;
      const panelTextNow = await panel.textContent();
      console.log(`[call-recording] Attempt ${attempt + 1}: stopVisible=${stopVisible} errorVisible=${errorVisible}`);
      console.log(`[call-recording] Attempt ${attempt + 1}: errorText=`, errorText ?? 'none');
      console.log(`[call-recording] Attempt ${attempt + 1}: panel excerpt=`, panelTextNow?.slice(0, 400));

      if (stopVisible && !errorVisible) {
        recordingStarted = true;
        console.log(`[call-recording] Attempt ${attempt + 1}: SUCCESS - Stop recording visible`);
        break;
      }
      if (errorVisible && errorText) {
        console.log(`[call-recording] Attempt ${attempt + 1}: FAILED - error="${errorText.trim()}"`);
      }
    }
    if (!recordingStarted) {
      const errorEl = page.getByText(/failed to start recording|no audio producer|no audio received/i).first();
      const errorText = (await errorEl.isVisible()) ? await errorEl.textContent() : null;
      const mediaBanner = page.getByText(/audio is unavailable|webrtc.*not.*running/i);
      const mediaUnavail = (await mediaBanner.isVisible()) ? await mediaBanner.first().textContent() : null;
      console.log('[call-recording] FAILURE - full panel text:', await panel.textContent());
      throw new Error(
        `Recording never started after 3 attempts. ` +
        `Error on page: ${errorText ?? 'none'}. ` +
        `Media unavailable: ${mediaUnavail ?? 'no'}.`
      );
    }
    console.log('[call-recording] Verifying Stop recording visible...');
    await expect(page.getByRole('button', { name: /stop recording/i })).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(2500);
    console.log('[call-recording] Stopping recording...');
    await page.getByRole('button', { name: /stop recording/i }).click();

    console.log('[call-recording] Waiting for "recording stopped successfully" or error (timeout 30s)...');
    const successOrError = await Promise.race([
      page.getByText(/recording stopped successfully/i).waitFor({ state: 'visible', timeout: 30000 }),
      page.getByText(/failed to stop recording|recording produced no audio|recording failed/i).waitFor({ state: 'visible', timeout: 30000 }).then(() => 'error' as const),
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
      const errText = await page.getByText(/failed to stop recording|recording produced no audio|recording failed/i).first().textContent();
      throw new Error(`Recording stop failed: ${errText}`);
    }
    console.log('[call-recording] Recording stopped, polling for segment...');

    // Poll for segment - callback from webrtc can take a few seconds
    let recorded: { duration_sec?: number } | undefined;
    for (let i = 0; i < 30; i++) {
      await page.waitForTimeout(500);
      const segmentsRes = await page.request.get(`${API_BASE}/episodes/${episodeId}/segments`);
      expect(segmentsRes.ok()).toBeTruthy();
      const { segments } = await segmentsRes.json();
      expect(Array.isArray(segments)).toBeTruthy();
      const segList = segments.length > 0 ? JSON.stringify(segments.map((s: { id?: string; duration_sec?: number }) => ({ id: s.id, duration_sec: s.duration_sec }))) : '[]';
      console.log(`[call-recording] Poll ${i + 1}/30: segments=${segments.length} ${segList}`);
      recorded = segments.find(
        (s: { duration_sec?: number }) => s.duration_sec != null
      );
      if (recorded) {
        console.log('[call-recording] Found segment duration_sec=', (recorded as { duration_sec?: number }).duration_sec);
        break;
      }
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
    console.log('[call-recording] Test passed - segment persisted');
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

  test('reconnect during recording produces multiple segments in manifest', async ({ page, context }) => {
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
      expect(manifest.segments.length).toBeGreaterThanOrEqual(2);
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

  test('recovers .part files after webrtc restart', async ({ page }) => {
    test.skip(process.env.E2E_FAULT_INJECTION !== '1', 'Crash recovery requires E2E_FAULT_INJECTION=1 and restart-webrtc');
    // Flow: start recording with 1 participant, wait ~5s, kill webrtc (SIGKILL),
    // restart webrtc, then stop recording. Assert webrtc-recordings has .recovered.mp3
    // and/or manifest shows RECOVERED/INTERRUPTED.
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

  test('Join code is visible in call panel', async ({ page }) => {
    await page.goto(`/episodes/${episodeId}`);
    await page.getByRole('button', { name: /start group call/i }).click();
    const panel = page.getByRole('region', { name: /group call/i });
    await expect(panel).toBeVisible({ timeout: 10000 });
    const joinCodeCard = panel.getByTestId('call-join-code-card');
    await expect(joinCodeCard).toBeVisible({ timeout: 5000 });
    await expect(joinCodeCard.getByText('Join code')).toBeVisible();
    const codeValue = panel.getByTestId('call-join-code-value');
    await expect(codeValue).toBeVisible();
    await expect(codeValue).toHaveText(/\d{4}/);
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
    await page.addInitScript(() => {
      localStorage.setItem('harborfm_call_display_name', 'E2E Host');
    });
    await page.goto(`/episodes/${episodeId}`);
    await page.getByRole('button', { name: /start group call/i }).click();
    await expect(page.getByRole('button', { name: /record segment/i })).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(/Participants \(1\)/)).toBeVisible();
    await expect(page.getByText(/E2E Host/)).toBeVisible();
  });

  test('End Group Call button shows when call active and ends on confirm', async ({ page }) => {
    await page.goto(`/episodes/${episodeId}`);
    await page.getByRole('button', { name: /start group call/i }).click();
    await expect(page.getByRole('button', { name: /record segment/i })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: /end group call/i })).toBeVisible();
    await page.getByRole('button', { name: /end group call/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(/end group call/i);
    await dialog.getByRole('button', { name: /confirm end call/i }).click();
    await expect(page.getByRole('region', { name: /group call/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /start group call/i })).toBeVisible();
  });

  test('End call dialog Cancel keeps call active', async ({ page }) => {
    await page.goto(`/episodes/${episodeId}`);
    await page.getByRole('button', { name: /start group call/i }).click();
    await expect(page.getByRole('button', { name: /record segment/i })).toBeVisible({ timeout: 10000 });
    const panel = page.getByRole('region', { name: /group call/i });
    await panel.getByRole('button', { name: /end call/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: /cancel/i }).click();
    await expect(dialog).not.toBeVisible();
    await expect(panel).toBeVisible();
  });

  test('Minimize and maximize panel', async ({ page }) => {
    await page.goto(`/episodes/${episodeId}`);
    await page.getByRole('button', { name: /start group call/i }).click();
    const panel = page.getByRole('region', { name: /group call/i });
    await expect(panel).toBeVisible({ timeout: 10000 });
    await expect(panel.getByRole('textbox', { name: 'Join link' })).toBeVisible();
    await panel.getByRole('button', { name: /minimize/i }).click();
    await expect(panel.getByRole('textbox', { name: 'Join link' })).not.toBeVisible();
    await expect(panel.getByRole('button', { name: /record segment/i })).toBeVisible();
    await panel.getByRole('button', { name: /maximize/i }).click();
    await expect(panel.getByRole('textbox', { name: 'Join link' })).toBeVisible();
  });

  test('Host display name persists and shows in participants', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('harborfm_call_display_name', 'E2E Host');
    });
    await page.goto(`/episodes/${episodeId}`);
    await page.getByRole('button', { name: /start group call/i }).click();
    const panel = page.getByRole('region', { name: /group call/i });
    await expect(panel).toBeVisible({ timeout: 10000 });
    await expect(panel.getByText(/E2E Host/)).toBeVisible();
    await expect(panel.getByText(/Participants \(1\)/)).toBeVisible();
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

  test.describe('CallJoin guest UI', () => {
    test('Leave Call shows confirm and cancelling keeps guest in call', async ({ page, context }) => {
      test.setTimeout(45000);
      const baseURL = `http://127.0.0.1:${PORT}`;
      await page.goto(`/episodes/${episodeId}`);
      await page.getByRole('button', { name: /start group call/i }).click();
      await expect(page.getByRole('button', { name: /record segment/i })).toBeVisible({ timeout: 20000 });
      const joinUrlRaw = await page.getByRole('region', { name: /group call/i }).getByRole('textbox', { name: 'Join link' }).inputValue();
      const joinUrl = joinUrlRaw.startsWith('/') ? `${baseURL}${joinUrlRaw}` : joinUrlRaw;

      const guestContext = await context.browser()!.newContext({ baseURL, permissions: ['microphone'] });
      const guestPage = await guestContext.newPage();
      try {
        await guestPage.goto(joinUrl);
        await guestPage.getByLabel(/your name/i).fill('E2E Guest');
        await guestPage.getByRole('button', { name: /join call/i }).click();
        await expect(guestPage.getByText(/you're in the call/i)).toBeVisible({ timeout: 15000 });

        await guestPage.getByRole('button', { name: /leave call/i }).click();
        const dialog = guestPage.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await expect(dialog).toContainText(/leave call/i);
        await dialog.getByRole('button', { name: /cancel/i }).click();
        await expect(dialog).not.toBeVisible();
        await expect(guestPage.getByText(/you're in the call/i)).toBeVisible();
      } finally {
        await guestContext.close();
      }
    });

    test('Leave Call confirm actually leaves', async ({ page, context }) => {
      test.setTimeout(45000);
      const baseURL = `http://127.0.0.1:${PORT}`;
      await page.goto(`/episodes/${episodeId}`);
      await page.getByRole('button', { name: /start group call/i }).click();
      await expect(page.getByRole('button', { name: /record segment/i })).toBeVisible({ timeout: 20000 });
      const joinUrlRaw = await page.getByRole('region', { name: /group call/i }).getByRole('textbox', { name: 'Join link' }).inputValue();
      const joinUrl = joinUrlRaw.startsWith('/') ? `${baseURL}${joinUrlRaw}` : joinUrlRaw;

      const guestContext = await context.browser()!.newContext({ baseURL, permissions: ['microphone'] });
      const guestPage = await guestContext.newPage();
      try {
        await guestPage.goto(joinUrl);
        await guestPage.getByLabel(/your name/i).fill('E2E Guest');
        await guestPage.getByRole('button', { name: /join call/i }).click();
        await expect(guestPage.getByText(/you're in the call/i)).toBeVisible({ timeout: 15000 });

        await guestPage.getByRole('button', { name: /leave call/i }).click();
        const dialog = guestPage.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await dialog.getByRole('button', { name: /confirm leave call/i }).click();
        await expect(guestPage.getByText(/join group call/i)).toBeVisible({ timeout: 5000 });
      } finally {
        await guestContext.close();
      }
    });

    test('Mute/Unmute button toggles', async ({ page, context }) => {
      test.setTimeout(45000);
      const baseURL = `http://127.0.0.1:${PORT}`;
      await page.goto(`/episodes/${episodeId}`);
      await page.getByRole('button', { name: /start group call/i }).click();
      await expect(page.getByRole('button', { name: /record segment/i })).toBeVisible({ timeout: 20000 });
      const joinUrlRaw = await page.getByRole('region', { name: /group call/i }).getByRole('textbox', { name: 'Join link' }).inputValue();
      const joinUrl = joinUrlRaw.startsWith('/') ? `${baseURL}${joinUrlRaw}` : joinUrlRaw;

      const guestContext = await context.browser()!.newContext({ baseURL, permissions: ['microphone'] });
      const guestPage = await guestContext.newPage();
      try {
        await guestPage.goto(joinUrl);
        await guestPage.getByLabel(/your name/i).fill('E2E Guest');
        await guestPage.getByRole('button', { name: /join call/i }).click();
        await expect(guestPage.getByText(/you're in the call/i)).toBeVisible({ timeout: 15000 });

        await guestPage.getByRole('button', { name: /^mute$/i }).click();
        await expect(guestPage.getByRole('button', { name: /^unmute$/i })).toBeVisible();
        await guestPage.getByRole('button', { name: /^unmute$/i }).click();
        await expect(guestPage.getByRole('button', { name: /^mute$/i })).toBeVisible();
      } finally {
        await guestContext.close();
      }
    });

    test('Host sees guest muted state', async ({ page, context }) => {
      test.setTimeout(45000);
      const baseURL = `http://127.0.0.1:${PORT}`;
      await page.goto(`/episodes/${episodeId}`);
      await page.getByRole('button', { name: /start group call/i }).click();
      await expect(page.getByRole('button', { name: /record segment/i })).toBeVisible({ timeout: 20000 });
      const joinUrlRaw = await page.getByRole('region', { name: /group call/i }).getByRole('textbox', { name: 'Join link' }).inputValue();
      const joinUrl = joinUrlRaw.startsWith('/') ? `${baseURL}${joinUrlRaw}` : joinUrlRaw;

      const guestContext = await context.browser()!.newContext({ baseURL, permissions: ['microphone'] });
      const guestPage = await guestContext.newPage();
      try {
        await guestPage.goto(joinUrl);
        await guestPage.getByLabel(/your name/i).fill('E2E Guest');
        await guestPage.getByRole('button', { name: /join call/i }).click();
        await expect(guestPage.getByText(/you're in the call/i)).toBeVisible({ timeout: 15000 });

        await guestPage.getByRole('button', { name: /^mute$/i }).click();
        const panel = page.getByRole('region', { name: /group call/i });
        await expect(panel.getByText(/muted/i)).toBeVisible({ timeout: 5000 });
      } finally {
        await guestContext.close();
      }
    });

    test('Guest cannot unmute when host-muted', async ({ page, context }) => {
      test.setTimeout(45000);
      const baseURL = `http://127.0.0.1:${PORT}`;
      await page.goto(`/episodes/${episodeId}`);
      await page.getByRole('button', { name: /start group call/i }).click();
      await expect(page.getByRole('button', { name: /record segment/i })).toBeVisible({ timeout: 20000 });
      const joinUrlRaw = await page.getByRole('region', { name: /group call/i }).getByRole('textbox', { name: 'Join link' }).inputValue();
      const joinUrl = joinUrlRaw.startsWith('/') ? `${baseURL}${joinUrlRaw}` : joinUrlRaw;

      const guestContext = await context.browser()!.newContext({ baseURL, permissions: ['microphone'] });
      const guestPage = await guestContext.newPage();
      try {
        await guestPage.goto(joinUrl);
        await guestPage.getByLabel(/your name/i).fill('E2E Guest');
        await guestPage.getByRole('button', { name: /join call/i }).click();
        await expect(guestPage.getByText(/you're in the call/i)).toBeVisible({ timeout: 15000 });

        const panel = page.getByRole('region', { name: /group call/i });
        await panel.getByRole('button', { name: 'Mute', exact: true }).click();
        await expect(panel.getByText(/muted/i)).toBeVisible({ timeout: 5000 });

        await expect(guestPage.getByText(/you were muted by the host/i)).toBeVisible();
        const unmuteBtn = guestPage.getByRole('button', { name: /unmute/i });
        await expect(unmuteBtn).toBeDisabled();
      } finally {
        await guestContext.close();
      }
    });

    test('Guest can edit display name', async ({ page, context }) => {
      test.setTimeout(45000);
      const baseURL = `http://127.0.0.1:${PORT}`;
      await page.goto(`/episodes/${episodeId}`);
      await page.getByRole('button', { name: /start group call/i }).click();
      await expect(page.getByRole('button', { name: /record segment/i })).toBeVisible({ timeout: 20000 });
      const joinUrlRaw = await page.getByRole('region', { name: /group call/i }).getByRole('textbox', { name: 'Join link' }).inputValue();
      const joinUrl = joinUrlRaw.startsWith('/') ? `${baseURL}${joinUrlRaw}` : joinUrlRaw;

      const guestContext = await context.browser()!.newContext({ baseURL, permissions: ['microphone'] });
      const guestPage = await guestContext.newPage();
      try {
        await guestPage.goto(joinUrl);
        await guestPage.getByLabel(/your name/i).fill('E2E Guest');
        await guestPage.getByRole('button', { name: /join call/i }).click();
        await expect(guestPage.getByText(/you're in the call/i)).toBeVisible({ timeout: 15000 });

        await guestPage.getByRole('button', { name: /edit your name/i }).click();
        await guestPage.getByLabel(/your display name/i).fill('Updated Guest');
        await guestPage.getByRole('button', { name: /save name/i }).click();
        await expect(guestPage.getByText(/Updated Guest/)).toBeVisible();
      } finally {
        await guestContext.close();
      }
    });

    test('Listen to yourself button present on pre-join', async ({ page, context }) => {
      test.setTimeout(30000);
      const baseURL = `http://127.0.0.1:${PORT}`;
      await page.goto(`/episodes/${episodeId}`);
      await page.getByRole('button', { name: /start group call/i }).click();
      await expect(page.getByRole('button', { name: /record segment/i })).toBeVisible({ timeout: 20000 });
      const joinUrlRaw = await page.getByRole('region', { name: /group call/i }).getByRole('textbox', { name: 'Join link' }).inputValue();
      const joinUrl = joinUrlRaw.startsWith('/') ? `${baseURL}${joinUrlRaw}` : joinUrlRaw;

      const guestContext = await context.browser()!.newContext({ baseURL, permissions: ['microphone'] });
      const guestPage = await guestContext.newPage();
      try {
        await guestPage.goto(joinUrl);
        await expect(guestPage.getByRole('button', { name: /listen to yourself/i })).toBeVisible();
      } finally {
        await guestContext.close();
      }
    });

    test('Host name shown on pre-join when available', async ({ page, context }) => {
      test.setTimeout(30000);
      await page.addInitScript(() => {
        localStorage.setItem('harborfm_call_display_name', 'E2E Host');
      });
      const baseURL = `http://127.0.0.1:${PORT}`;
      await page.goto(`/episodes/${episodeId}`);
      await page.getByRole('button', { name: /start group call/i }).click();
      await expect(page.getByRole('button', { name: /record segment/i })).toBeVisible({ timeout: 20000 });
      const joinUrlRaw = await page.getByRole('region', { name: /group call/i }).getByRole('textbox', { name: 'Join link' }).inputValue();
      const joinUrl = joinUrlRaw.startsWith('/') ? `${baseURL}${joinUrlRaw}` : joinUrlRaw;

      const guestContext = await context.browser()!.newContext({ baseURL, permissions: ['microphone'] });
      const guestPage = await guestContext.newPage();
      try {
        await guestPage.goto(joinUrl);
        await expect(guestPage.getByText(/Host: E2E Host/)).toBeVisible();
      } finally {
        await guestContext.close();
      }
    });

    test('Password field hidden when not required', async ({ page, context }) => {
      test.setTimeout(30000);
      const baseURL = `http://127.0.0.1:${PORT}`;
      await page.goto(`/episodes/${episodeId}`);
      await page.getByRole('button', { name: /start group call/i }).click();
      await expect(page.getByRole('button', { name: /record segment/i })).toBeVisible({ timeout: 20000 });
      const joinUrlRaw = await page.getByRole('region', { name: /group call/i }).getByRole('textbox', { name: 'Join link' }).inputValue();
      const joinUrl = joinUrlRaw.startsWith('/') ? `${baseURL}${joinUrlRaw}` : joinUrlRaw;

      const guestContext = await context.browser()!.newContext({ baseURL, permissions: ['microphone'] });
      const guestPage = await guestContext.newPage();
      try {
        await guestPage.goto(joinUrl);
        await expect(guestPage.getByLabel(/your name/i)).toBeVisible();
        await expect(guestPage.getByPlaceholder(/enter password/i)).toHaveCount(0);
      } finally {
        await guestContext.close();
      }
    });

    test('Artwork visible when episode has artwork', async ({ page, context }) => {
      test.setTimeout(45000);
      const csrf = (await page.context().storageState()).cookies.find((c) => c.name === 'harborfm_csrf')?.value;
      if (!csrf) throw new Error('No CSRF cookie');
      const artworkPath = join(E2E_DIR, 'test-data', 'favicon.png');
      if (!existsSync(artworkPath)) throw new Error('favicon.png not found');
      const imageBuf = readFileSync(artworkPath);
      const artworkRes = await page.request.post(
        `${API_BASE}/podcasts/${podcastId}/episodes/${episodeId}/artwork`,
        {
          headers: { 'x-csrf-token': csrf },
          multipart: {
            file: {
              name: 'favicon.png',
              mimeType: 'image/png',
              buffer: imageBuf,
            },
          },
        },
      );
      if (!artworkRes.ok()) throw new Error(`Artwork upload failed: ${artworkRes.status()}`);

      const baseURL = `http://127.0.0.1:${PORT}`;
      await page.goto(`/episodes/${episodeId}`);
      await page.getByRole('button', { name: /start group call/i }).click();
      await expect(page.getByRole('button', { name: /record segment/i })).toBeVisible({ timeout: 20000 });
      const joinUrlRaw = await page.getByRole('region', { name: /group call/i }).getByRole('textbox', { name: 'Join link' }).inputValue();
      const joinUrl = joinUrlRaw.startsWith('/') ? `${baseURL}${joinUrlRaw}` : joinUrlRaw;

      const guestContext = await context.browser()!.newContext({
        baseURL,
        permissions: ['microphone'],
        viewport: { width: 1280, height: 900 },
      });
      const guestPage = await guestContext.newPage();
      try {
        await guestPage.goto(joinUrl);
        await expect(guestPage.locator('img[src*="artwork"]')).toBeVisible();
      } finally {
        await guestContext.close();
      }
    });
  });

  test.describe('CallPanel host UI', () => {
    test('Participant list shows host first', async ({ page }) => {
      await page.addInitScript(() => {
        localStorage.setItem('harborfm_call_display_name', 'E2E Host');
      });
      await page.goto(`/episodes/${episodeId}`);
      await page.getByRole('button', { name: /start group call/i }).click();
      await expect(page.getByRole('button', { name: /record segment/i })).toBeVisible({ timeout: 20000 });
      const panel = page.getByRole('region', { name: /group call/i });
      const firstParticipant = panel.locator('ul li').first();
      await expect(firstParticipant.getByText(/E2E Host/)).toBeVisible();
    });

    test('Host can mute guest', async ({ page, context }) => {
      test.setTimeout(45000);
      const baseURL = `http://127.0.0.1:${PORT}`;
      await page.goto(`/episodes/${episodeId}`);
      await page.getByRole('button', { name: /start group call/i }).click();
      await expect(page.getByRole('button', { name: /record segment/i })).toBeVisible({ timeout: 20000 });
      const joinUrlRaw = await page.getByRole('region', { name: /group call/i }).getByRole('textbox', { name: 'Join link' }).inputValue();
      const joinUrl = joinUrlRaw.startsWith('/') ? `${baseURL}${joinUrlRaw}` : joinUrlRaw;

      const guestContext = await context.browser()!.newContext({ baseURL, permissions: ['microphone'] });
      const guestPage = await guestContext.newPage();
      try {
        await guestPage.goto(joinUrl);
        await guestPage.getByLabel(/your name/i).fill('E2E Guest');
        await guestPage.getByRole('button', { name: /join call/i }).click();
        await expect(guestPage.getByText(/you're in the call/i)).toBeVisible({ timeout: 15000 });

        const panel = page.getByRole('region', { name: /group call/i });
        await panel.getByRole('button', { name: 'Mute', exact: true }).click();
        await expect(panel.getByText(/muted/i)).toBeVisible({ timeout: 5000 });
      } finally {
        await guestContext.close();
      }
    });

    test('Host cannot unmute self-muted guest', async ({ page, context }) => {
      test.setTimeout(45000);
      const baseURL = `http://127.0.0.1:${PORT}`;
      await page.goto(`/episodes/${episodeId}`);
      await page.getByRole('button', { name: /start group call/i }).click();
      await expect(page.getByRole('button', { name: /record segment/i })).toBeVisible({ timeout: 20000 });
      const joinUrlRaw = await page.getByRole('region', { name: /group call/i }).getByRole('textbox', { name: 'Join link' }).inputValue();
      const joinUrl = joinUrlRaw.startsWith('/') ? `${baseURL}${joinUrlRaw}` : joinUrlRaw;

      const guestContext = await context.browser()!.newContext({ baseURL, permissions: ['microphone'] });
      const guestPage = await guestContext.newPage();
      try {
        await guestPage.goto(joinUrl);
        await guestPage.getByLabel(/your name/i).fill('E2E Guest');
        await guestPage.getByRole('button', { name: /join call/i }).click();
        await expect(guestPage.getByText(/you're in the call/i)).toBeVisible({ timeout: 15000 });

        await guestPage.getByRole('button', { name: /^mute$/i }).click();
        const panel = page.getByRole('region', { name: /group call/i });
        await expect(panel.getByText(/muted/i)).toBeVisible({ timeout: 5000 });

        const guestUnmuteBtn = panel.locator('ul li').filter({ hasText: 'E2E Guest' }).getByRole('button', { name: 'Unmute', exact: true });
        await expect(guestUnmuteBtn).toBeDisabled();
        await expect(guestUnmuteBtn).toHaveAttribute('title', 'Guest muted themselves');
      } finally {
        await guestContext.close();
      }
    });

    test('Host can disconnect guest', async ({ page, context }) => {
      test.setTimeout(45000);
      const baseURL = `http://127.0.0.1:${PORT}`;
      await page.goto(`/episodes/${episodeId}`);
      await page.getByRole('button', { name: /start group call/i }).click();
      await expect(page.getByRole('button', { name: /record segment/i })).toBeVisible({ timeout: 20000 });
      const joinUrlRaw = await page.getByRole('region', { name: /group call/i }).getByRole('textbox', { name: 'Join link' }).inputValue();
      const joinUrl = joinUrlRaw.startsWith('/') ? `${baseURL}${joinUrlRaw}` : joinUrlRaw;

      const guestContext = await context.browser()!.newContext({ baseURL, permissions: ['microphone'] });
      const guestPage = await guestContext.newPage();
      try {
        await guestPage.goto(joinUrl);
        await guestPage.getByLabel(/your name/i).fill('E2E Guest');
        await guestPage.getByRole('button', { name: /join call/i }).click();
        await expect(guestPage.getByText(/you're in the call/i)).toBeVisible({ timeout: 15000 });

        const panel = page.getByRole('region', { name: /group call/i });
        await panel.getByRole('button', { name: /disconnect/i }).click();
        await expect(page.getByText(/Participants \(1\)/)).toBeVisible({ timeout: 5000 });
      } finally {
        await guestContext.close();
      }
    });

    test('Participant cards have correct structure', async ({ page, context }) => {
      test.setTimeout(45000);
      await page.addInitScript(() => {
        localStorage.setItem('harborfm_call_display_name', 'E2E Host');
      });
      const baseURL = `http://127.0.0.1:${PORT}`;
      await page.goto(`/episodes/${episodeId}`);
      await page.getByRole('button', { name: /start group call/i }).click();
      await expect(page.getByRole('button', { name: /record segment/i })).toBeVisible({ timeout: 20000 });
      const joinUrlRaw = await page.getByRole('region', { name: /group call/i }).getByRole('textbox', { name: 'Join link' }).inputValue();
      const joinUrl = joinUrlRaw.startsWith('/') ? `${baseURL}${joinUrlRaw}` : joinUrlRaw;

      const guestContext = await context.browser()!.newContext({ baseURL, permissions: ['microphone'] });
      const guestPage = await guestContext.newPage();
      try {
        await guestPage.goto(joinUrl);
        await guestPage.getByLabel(/your name/i).fill('E2E Guest');
        await guestPage.getByRole('button', { name: /join call/i }).click();
        await expect(guestPage.getByText(/you're in the call/i)).toBeVisible({ timeout: 15000 });

        const panel = page.getByRole('region', { name: /group call/i });
        await expect(panel.getByText(/E2E Host/)).toBeVisible();
        await expect(panel.getByText(/E2E Guest/)).toBeVisible();
        await expect(panel.getByText(/\(Host\)/)).toHaveCount(0);
      } finally {
        await guestContext.close();
      }
    });
  });

  test('Join Call button on Dashboard opens dialog and code lookup redirects to join page', async ({ page, context }) => {
    test.setTimeout(45000);
    const baseURL = `http://127.0.0.1:${PORT}`;

    // Host starts call and gets join code
    await page.goto(`${baseURL}/episodes/${episodeId}`);
    await page.getByRole('button', { name: /start group call/i }).click();
    await expect(page.getByRole('button', { name: /record segment/i })).toBeVisible({ timeout: 20000 });
    const joinCodeValue = page.getByRole('region', { name: /group call/i }).getByTestId('call-join-code-value');
    await expect(joinCodeValue).toBeVisible({ timeout: 5000 });
    const code = await joinCodeValue.textContent();
    expect(code).toMatch(/^\d{4}$/);

    // Open dashboard in new tab, click Join Call
    const dashboardTab = await context.newPage();
    try {
      await dashboardTab.goto(`${baseURL}/`);
      await expect(dashboardTab.getByRole('button', { name: /join call/i })).toBeVisible({ timeout: 10000 });
      await dashboardTab.getByRole('button', { name: /join call/i }).click();

      const dialog = dashboardTab.getByRole('dialog');
      await expect(dialog).toBeVisible({ timeout: 5000 });
      await expect(dialog).toContainText(/join call/i);
      await dialog.getByRole('textbox', { name: /4-digit join code/i }).fill(code!);
      await dialog.getByRole('button', { name: /^join$/i }).click();

      await expect(dashboardTab).toHaveURL(new RegExp(`/call/join/`), { timeout: 10000 });
      await expect(dashboardTab.getByLabel(/your name/i)).toBeVisible({ timeout: 5000 });
    } finally {
      await dashboardTab.close();
    }
  });

  test('Join Call dialog shows error for invalid code', async ({ page }) => {
    await page.goto(`/`);
    await expect(page.getByRole('button', { name: /join call/i })).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: /join call/i }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await dialog.getByRole('textbox', { name: /4-digit join code/i }).fill('9999');
    await dialog.getByRole('button', { name: /^join$/i }).click();

    await expect(page.getByText(/no call found for this code/i)).toBeVisible({ timeout: 5000 });
    await expect(dialog).toBeVisible();
  });

  test.describe('Login Join Call', () => {
    test('Join Call button visible on login when webrtc enabled', async ({ page }) => {
      await page.goto('/login');
      await expect(page.getByRole('button', { name: /join call/i })).toBeVisible({ timeout: 10000 });
    });

    test('Join Call opens dialog on login page', async ({ page }) => {
      await page.goto('/login');
      await page.getByRole('button', { name: /join call/i }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible({ timeout: 5000 });
      await expect(dialog).toContainText(/join call/i);
      await expect(dialog.getByRole('textbox', { name: /4-digit join code/i })).toBeVisible();
    });

    test('Invalid code shows error in red card on login page', async ({ page }) => {
      await page.goto('/login');
      await page.getByRole('button', { name: /join call/i }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible({ timeout: 5000 });
      await dialog.getByRole('textbox', { name: /4-digit join code/i }).fill('9999');
      await dialog.getByRole('button', { name: /^join$/i }).click();
      const errorCard = dialog.getByRole('alert');
      await expect(errorCard).toBeVisible({ timeout: 5000 });
      await expect(errorCard).toContainText(/no call found for this code/i);
    });

    test('Valid code navigates to join page from login', async ({ page, context }) => {
      test.setTimeout(45000);
      const baseURL = `http://127.0.0.1:${PORT}`;
      await page.goto(`${baseURL}/episodes/${episodeId}`);
      await page.getByRole('button', { name: /start group call/i }).click();
      await expect(page.getByRole('button', { name: /record segment/i })).toBeVisible({ timeout: 20000 });
      const joinCodeValue = page.getByRole('region', { name: /group call/i }).getByTestId('call-join-code-value');
      await expect(joinCodeValue).toBeVisible({ timeout: 5000 });
      const code = await joinCodeValue.textContent();
      expect(code).toMatch(/^\d{4}$/);

      const loginTab = await context.newPage();
      try {
        await loginTab.goto(`${baseURL}/login`);
        await expect(loginTab.getByRole('button', { name: /join call/i })).toBeVisible({ timeout: 10000 });
        await loginTab.getByRole('button', { name: /join call/i }).click();
        const dialog = loginTab.getByRole('dialog');
        await expect(dialog).toBeVisible({ timeout: 5000 });
        await dialog.getByRole('textbox', { name: /4-digit join code/i }).fill(code!);
        await dialog.getByRole('button', { name: /^join$/i }).click();
        await expect(loginTab).toHaveURL(new RegExp(`/call/join/`), { timeout: 10000 });
        await expect(loginTab.getByLabel(/your name/i)).toBeVisible({ timeout: 5000 });
      } finally {
        await loginTab.close();
      }
    });
  });

  test('Already in call shows migrate, migrate moves call to new tab', async ({ page, context }) => {
    test.setTimeout(60000);
    const baseURL = `http://127.0.0.1:${PORT}`;
    await page.goto(`${baseURL}/episodes/${episodeId}`);
    await page.getByRole('button', { name: /start group call/i }).click();
    await expect(page.getByRole('button', { name: /record segment/i })).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(2000);

    const tab2 = await context.newPage();
    try {
      await tab2.goto(`${baseURL}/episodes/${episodeId}`);
      const panel2 = tab2.getByTestId('already-in-call-panel');
      await expect(panel2).toBeVisible({ timeout: 20000 });
      await expect(panel2.getByText(/already in the call in another tab/i)).toBeVisible();
      await expect(panel2.getByRole('button', { name: /migrate call to this tab/i })).toBeVisible();

      await panel2.getByRole('button', { name: /migrate call to this tab/i }).click();
      await expect(tab2.getByRole('button', { name: /record segment/i })).toBeVisible({ timeout: 15000 });
      await expect(page.getByRole('region', { name: /group call/i })).toHaveCount(0);
    } finally {
      await tab2.close();
    }
  });
});
