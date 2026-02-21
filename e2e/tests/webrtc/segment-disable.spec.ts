/// <reference types="node" />
import { test, expect } from '@playwright/test';
import { createCallRecordingFixture, gotoEpisodeAndStartCall, API_BASE } from './call-recording-helpers';

let episodeId: string;
let podcastId: string;

test.describe('Segment enable/disable', () => {
  test.beforeEach(async ({ page }) => {
    const fixture = await createCallRecordingFixture(page);
    episodeId = fixture.episodeId;
    podcastId = fixture.podcastId;
  });

  test('toggle disable then enable updates segment and UI', async ({ page }) => {
    test.setTimeout(90000);
    await page.goto(`/episodes/${episodeId}`);

    const startBtn = page.getByRole('button', { name: /start group call/i });
    await startBtn.click();

    const recordBtn = page.getByRole('button', { name: /record segment/i });
    await expect(recordBtn).toBeVisible({ timeout: 10000 });
    await expect(recordBtn).toHaveAttribute('data-producer-ready', 'true', { timeout: 25000 });

    const panel = page.getByRole('region', { name: /group call/i });
    const stopBtn = page.getByRole('button', { name: /stop recording/i });
    await page.waitForTimeout(2000);
    await recordBtn.click();
    await expect(stopBtn).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(2500);
    await stopBtn.click();

    await expect(
      page.getByRole('status').filter({ hasText: /recording stopped successfully|segment added successfully|finalizing|processing/i }),
    ).toBeVisible({ timeout: 30000 });

    let segmentId: string | undefined;
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(500);
      const segmentsRes = await page.request.get(`${API_BASE}/episodes/${episodeId}/segments`);
      if (!segmentsRes.ok()) continue;
      const { segments } = await segmentsRes.json();
      if (!Array.isArray(segments) || segments.length === 0) continue;
      const recorded = segments.find((s: { duration_sec?: number }) => s.duration_sec != null);
      if (recorded) {
        segmentId = recorded.id;
        break;
      }
    }
    expect(segmentId).toBeDefined();

    await page.waitForTimeout(1000);
    await expect(page.getByRole('heading', { name: /build your episode/i })).toBeVisible({ timeout: 10000 });

    const eyeBtn = page.getByRole('button', { name: /exclude from final episode/i });
    await expect(eyeBtn).toBeVisible({ timeout: 5000 });
    await eyeBtn.click();

    await page.waitForTimeout(500);
    const afterDisableRes = await page.request.get(`${API_BASE}/episodes/${episodeId}/segments`);
    expect(afterDisableRes.ok()).toBeTruthy();
    const { segments: afterDisable } = await afterDisableRes.json();
    const segDisabled = afterDisable.find((s: { id: string }) => s.id === segmentId);
    expect(segDisabled).toBeDefined();
    expect(segDisabled.disabled).toBe(true);

    const includeBtn = page.getByRole('button', { name: /include in final episode/i });
    await expect(includeBtn).toBeVisible({ timeout: 3000 });
    await includeBtn.click();

    await page.waitForTimeout(500);
    const afterEnableRes = await page.request.get(`${API_BASE}/episodes/${episodeId}/segments`);
    expect(afterEnableRes.ok()).toBeTruthy();
    const { segments: afterEnable } = await afterEnableRes.json();
    const segEnabled = afterEnable.find((s: { id: string }) => s.id === segmentId);
    expect(segEnabled).toBeDefined();
    expect(segEnabled.disabled).toBe(false);
  });

  test('Make Final Episode disabled when all segments disabled', async ({ page }) => {
    test.setTimeout(90000);
    await page.goto(`/episodes/${episodeId}`);

    const startBtn = page.getByRole('button', { name: /start group call/i });
    await startBtn.click();

    const recordBtn = page.getByRole('button', { name: /record segment/i });
    await expect(recordBtn).toBeVisible({ timeout: 10000 });
    await expect(recordBtn).toHaveAttribute('data-producer-ready', 'true', { timeout: 25000 });

    const stopBtn = page.getByRole('button', { name: /stop recording/i });
    await page.waitForTimeout(2000);
    await recordBtn.click();
    await expect(stopBtn).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(2500);
    await stopBtn.click();

    await expect(
      page.getByRole('status').filter({ hasText: /recording stopped successfully|segment added successfully|finalizing|processing/i }),
    ).toBeVisible({ timeout: 30000 });

    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(500);
      const segmentsRes = await page.request.get(`${API_BASE}/episodes/${episodeId}/segments`);
      if (!segmentsRes.ok()) continue;
      const { segments } = await segmentsRes.json();
      if (Array.isArray(segments) && segments.some((s: { duration_sec?: number }) => s.duration_sec != null)) break;
    }

    await expect(page.getByRole('heading', { name: /build your episode/i })).toBeVisible({ timeout: 10000 });

    const eyeBtn = page.getByRole('button', { name: /exclude from final episode/i });
    await expect(eyeBtn).toBeVisible({ timeout: 5000 });
    await eyeBtn.click();

    await page.waitForTimeout(500);
    const buildBtn = page.getByRole('button', { name: /generate episode audio/i });
    await expect(buildBtn).toBeDisabled();

    const includeBtn = page.getByRole('button', { name: /include in final episode/i });
    await expect(includeBtn).toBeVisible({ timeout: 3000 });
    await includeBtn.click();

    await page.waitForTimeout(500);
    await expect(buildBtn).toBeEnabled();
  });
});
