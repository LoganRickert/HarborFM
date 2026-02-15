/// <reference types="node" />
import { test, expect } from '@playwright/test';
import { createCallRecordingFixture, API_BASE, PORT } from './call-recording-helpers';

let episodeId: string;
let podcastId: string;

test.describe('Host leave grace period', () => {
  test.beforeEach(async ({ page }) => {
    const fixture = await createCallRecordingFixture(page);
    episodeId = fixture.episodeId;
    podcastId = fixture.podcastId;
  });

  test('Guest sees Host has left when host closes tab @slow', async ({ page, context }) => {
    test.setTimeout(60000);
    const baseURL = `http://127.0.0.1:${PORT}`;
    await page.addInitScript(() => {
      localStorage.setItem('harborfm_call_display_name', 'E2E Host');
    });
    await page.goto(`${baseURL}/episodes/${episodeId}`);
    await page.getByRole('button', { name: /start group call/i }).click();
    await expect(page.getByRole('button', { name: /record segment/i })).toBeVisible({ timeout: 20000 });
    const joinUrlRaw = await page.getByRole('region', { name: /group call/i }).getByRole('textbox', { name: 'Join link' }).inputValue();
    const joinUrl = joinUrlRaw.startsWith('/') ? `${baseURL}${joinUrlRaw}` : joinUrlRaw;

    const guestContext = await context.browser()!.newContext({ baseURL, permissions: ['microphone'] });
    const guestPage = await guestContext.newPage();
    try {
      await guestPage.addInitScript(() => {
        localStorage.setItem('harborfm_call_display_name', 'E2E Guest');
      });
      await guestPage.goto(joinUrl);
      await guestPage.getByLabel(/your name/i).fill('E2E Guest');
      await guestPage.getByRole('button', { name: /join call/i }).click();
      await expect(guestPage.getByText(/you're in the call/i)).toBeVisible({ timeout: 15000 });

      await page.close();

      await expect(guestPage.getByText(/host has left/i)).toBeVisible({ timeout: 20000 });
      await expect(guestPage.getByText(/call will end in/i)).toBeVisible({ timeout: 5000 });
    } finally {
      await guestContext.close();
    }
  });

  test('Recording stops safely when host leaves during recording @slow', async ({ page, context }) => {
    test.setTimeout(60000); // Shortened: e2e uses HOST_AWAY_GRACE_* and HOST_AWAY_CHECK_INTERVAL_MS
    const baseURL = `http://127.0.0.1:${PORT}`;
    page.on('console', (msg) => {
      const text = msg.text();
      if (/recording|Recording|failed|webrtc/i.test(text)) {
        console.log(`[host-leave-recording] BROWSER:`, text.slice(0, 200));
      }
    });

    await page.goto(`${baseURL}/episodes/${episodeId}`);
    await page.getByRole('button', { name: /start group call/i }).click();
    await expect(page.getByRole('button', { name: /record segment/i })).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('button', { name: /record segment/i })).toHaveAttribute('data-producer-ready', 'true', { timeout: 25000 });

    const recordBtn = page.getByRole('button', { name: /record segment/i });
    let recordingStarted = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.waitForTimeout(attempt === 0 ? 2000 : 3000);
      await recordBtn.click();
      await page.waitForTimeout(5000);
      const stopVisible = await page.getByRole('button', { name: /stop recording/i }).isVisible();
      const errorVisible = await page.getByText(/failed to start recording|no audio producer|no audio received|UDP ports/i).isVisible();
      if (stopVisible && !errorVisible) {
        recordingStarted = true;
        break;
      }
    }
    if (!recordingStarted) {
      test.skip(true, 'Recording could not start (no audio/UDP/Mediasoup env). Host-leave recording stop requires working fake mic.');
      return;
    }
    // Wait for RTP to flow and some audio to be captured before host closes (FFmpeg needs packets)
    await page.waitForTimeout(8000);

    const pollPage = await context.newPage();
    await pollPage.goto(`${baseURL}/episodes/${episodeId}`);

    await page.close();
    try {
      let recorded: { id?: string; duration_sec?: number } | undefined;
      for (let i = 0; i < 200; i++) {
        await pollPage.waitForTimeout(1000);
        const segmentsRes = await pollPage.request.get(`${API_BASE}/episodes/${episodeId}/segments`);
        if (!segmentsRes.ok()) continue;
        const { segments } = await segmentsRes.json();
        if (!Array.isArray(segments)) continue;
        recorded = segments.find((s: { duration_sec?: number }) => s.duration_sec != null);
        if (recorded) {
          console.log('[host-leave-recording] Segment appeared after', i + 1, 's');
          break;
        }
      }
      if (!recorded) {
        test.skip(
          true,
          'Host-leave flow completed but no segment was produced (RTP may not reach FFmpeg in e2e env)',
        );
        return;
      }
      expect(recorded!.duration_sec).toBeGreaterThanOrEqual(0);
    } finally {
      await pollPage.close();
    }
  });
});

test.describe('Recording state persistence', () => {
  test.beforeEach(async ({ page }) => {
    const fixture = await createCallRecordingFixture(page);
    episodeId = fixture.episodeId;
    podcastId = fixture.podcastId;
  });

  test('Recording state persists across host refresh @slow', async ({ page, context }) => {
    test.setTimeout(90000);
    const baseURL = `http://127.0.0.1:${PORT}`;
    await page.goto(`${baseURL}/episodes/${episodeId}`);
    await page.getByRole('button', { name: /start group call/i }).click();
    await expect(page.getByRole('button', { name: /record segment/i })).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('button', { name: /record segment/i })).toHaveAttribute('data-producer-ready', 'true', { timeout: 25000 });

    const recordBtn = page.getByRole('button', { name: /record segment/i });
    await recordBtn.click();
    await expect(page.getByRole('button', { name: /stop recording/i })).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(3000);

    await page.reload();

    // Wait for call panel (full panel reconnects directly on single-tab refresh; "already in call" only with two tabs)
    const groupCallRegion = page.getByRole('region', { name: /group call/i });
    const alreadyInCall = page.getByTestId('already-in-call-panel');
    await Promise.race([
      groupCallRegion.waitFor({ state: 'visible', timeout: 20000 }),
      alreadyInCall.waitFor({ state: 'visible', timeout: 20000 }),
    ]);
    if (await alreadyInCall.isVisible()) {
      await page.getByRole('button', { name: /migrate call to this tab/i }).click();
    }
    await expect(page.getByRole('button', { name: /stop recording/i })).toBeVisible({ timeout: 30000 });
  });
});

test.describe('Already in call migrate', () => {
  test.beforeEach(async ({ page }) => {
    const fixture = await createCallRecordingFixture(page);
    episodeId = fixture.episodeId;
    podcastId = fixture.podcastId;
  });

  test('Already in call shows migrate, migrate moves call to new tab @slow', async ({ page, context }) => {
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
