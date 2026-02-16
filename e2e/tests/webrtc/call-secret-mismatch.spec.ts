/// <reference types="node" />
import { test, expect } from '@playwright/test';
import {
  createCallRecordingFixture,
  createLibraryAsset,
  PORT,
} from './call-recording-helpers';

/**
 * Tests for recording and soundboard bugs when RECORDING_CALLBACK_SECRET mismatches
 * between the main app and webrtc service.
 *
 * Run with: E2E_SECRET_MISMATCH=1 pnpm run e2e:webrtc -- call-secret-mismatch.spec.ts
 *
 * Requires webrtc to be started with RECORDING_CALLBACK_SECRET_WEBRTC=mismatched-e2e-secret
 * (handled by run-e2e-webrtc.sh when E2E_SECRET_MISMATCH=1).
 */
test.describe('Recording and soundboard secret mismatch', () => {
  test.skip(
    process.env.E2E_SECRET_MISMATCH !== '1',
    'These tests require E2E_SECRET_MISMATCH=1 to run webrtc with a mismatched secret'
  );

  let episodeId: string;
  let podcastId: string;
  let hasLibraryAsset: boolean;

  test.beforeEach(async ({ page }) => {
    const fixture = await createCallRecordingFixture(page);
    episodeId = fixture.episodeId;
    podcastId = fixture.podcastId;
    hasLibraryAsset = (await createLibraryAsset(page)) != null;
  });

  test('recording: first click shows error, second click shows error (not stuck on Starting)', async ({ page }) => {
    test.setTimeout(20000);
    await page.goto(`/episodes/${episodeId}`);
    await page.getByRole('button', { name: /start group call/i }).click();
    const panel = page.getByRole('region', { name: /group call/i });
    await expect(panel).toBeVisible({ timeout: 10000 });

    const recordBtn = page.getByRole('button', { name: /record segment/i });
    await expect(recordBtn).toBeVisible({ timeout: 15000 });
    await expect(recordBtn).toHaveAttribute('data-producer-ready', 'true', { timeout: 25000 });

    await page.waitForTimeout(2000);

    // First click - should show error (secret mismatch), not "Starting..." indefinitely
    await recordBtn.click();
    const errorCard = panel.getByRole('alert');
    await expect(errorCard).toBeVisible({ timeout: 8000 });
    await expect(errorCard).toContainText(/recording callback secret mismatch|RECORDING_CALLBACK_SECRET/i);

    // Second click - should show error again (lock released), NOT stuck on "Starting..."
    await recordBtn.click();
    const startingText = page.getByText('Starting…');
    await expect(startingText).not.toBeVisible({ timeout: 3000 });
    await expect(errorCard).toBeVisible();
  });

  test('soundboard: play shows error and does not show as playing', async ({ page }) => {
    test.setTimeout(30000);
    if (!hasLibraryAsset) {
      test.skip(true, 'No library asset created (fake-mic.wav may be missing)');
      return;
    }
    await page.goto(`/episodes/${episodeId}`);
    await page.getByRole('button', { name: /start group call/i }).click();
    const panel = page.getByRole('region', { name: /group call/i });
    await expect(panel).toBeVisible({ timeout: 10000 });
    await expect(panel.getByRole('button', { name: /record segment/i })).toBeVisible({ timeout: 15000 });
    await expect(panel.getByRole('button', { name: /record segment/i })).toHaveAttribute(
      'data-producer-ready',
      'true',
      { timeout: 25000 }
    );

    await page.waitForTimeout(2000);

    // Open soundboard
    await panel.getByTestId('soundboard-open-btn').click();
    await expect(panel.getByRole('list')).toBeVisible({ timeout: 5000 });

    // Find any play button (first soundboard item) - scope to sound list to avoid Record Segment btn
    const soundList = panel.getByRole('list');
    const playBtn = soundList.getByRole('button', { name: /Play/ }).first();
    await expect(playBtn).toBeVisible({ timeout: 5000 });
    await playBtn.click();

    // Error should appear in the alert card (soundboard access denied)
    const errorCard = panel.getByRole('alert');
    await expect(errorCard).toBeVisible({ timeout: 8000 });
    await expect(errorCard).toContainText(/soundboard access denied|RECORDING_CALLBACK_SECRET/i);

    // Soundboard should NOT show as playing - the play button should still be visible (not replaced by Pause)
    await expect(playBtn).toBeVisible();
  });
});
