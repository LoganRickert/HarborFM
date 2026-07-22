/// <reference types="node" />
import { test, expect } from '@playwright/test';
import {
  createCallRecordingFixture,
  API_BASE,
} from './call-recording-helpers';
import {
  fakeDialInJoin,
  fakeDialInLeave,
  readJoinCodeFromHost,
  expectPhoneSegmentFiles,
  ensureDialInSettings,
} from './call-dial-in-helpers';

let episodeId: string;
let podcastId: string;

test.describe('Call dial-in core (FakeDialIn)', () => {
  test.beforeEach(async ({ page }) => {
    const fixture = await createCallRecordingFixture(page);
    episodeId = fixture.episodeId;
    podcastId = fixture.podcastId;
    await ensureDialInSettings(page.request);
  });

  test('fake phone joins live call by join code', async ({ page }) => {
    test.setTimeout(30000);
    await page.goto(`/episodes/${episodeId}`);
    await page.getByRole('button', { name: /start group call/i }).click();
    await expect(page.getByRole('button', { name: /record segment/i })).toBeVisible({
      timeout: 20000,
    });

    const joinCode = await readJoinCodeFromHost(page);
    const joined = await fakeDialInJoin(page.request, {
      joinCode,
      displayName: 'E2E Phone One',
      toneHz: 880,
    });
    expect(joined.participantId).toBeTruthy();
    expect(joined.producerId).toBeTruthy();

    await expect(page.getByText(/Participants \(2\)/)).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('call-participant-phone')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('E2E Phone One')).toBeVisible();
  });

  test('two fake phones join same call', async ({ page }) => {
    test.setTimeout(30000);
    await page.goto(`/episodes/${episodeId}`);
    await page.getByRole('button', { name: /start group call/i }).click();
    await expect(page.getByRole('button', { name: /record segment/i })).toBeVisible({
      timeout: 20000,
    });

    const joinCode = await readJoinCodeFromHost(page);
    await fakeDialInJoin(page.request, { joinCode, displayName: 'Phone A', toneHz: 660 });
    await fakeDialInJoin(page.request, { joinCode, displayName: 'Phone B', toneHz: 990 });

    await expect(page.getByText(/Participants \(3\)/)).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('call-participant-phone')).toHaveCount(2);
    await expect(page.getByText('Phone A')).toBeVisible();
    await expect(page.getByText('Phone B')).toBeVisible();
  });

  test('recording with one fake phone creates separate phone segment', async ({ page }) => {
    test.setTimeout(60000);
    await page.goto(`/episodes/${episodeId}`);
    await page.getByRole('button', { name: /start group call/i }).click();
    const recordBtn = page.getByRole('button', { name: /record segment/i });
    await expect(recordBtn).toBeVisible({ timeout: 20000 });
    await expect(recordBtn).toHaveAttribute('data-producer-ready', 'true', { timeout: 25000 });

    const joinCode = await readJoinCodeFromHost(page);
    await fakeDialInJoin(page.request, { joinCode, displayName: 'Record Phone', toneHz: 770 });
    await expect(page.getByText(/Participants \(2\)/)).toBeVisible({ timeout: 15000 });

    await page.waitForTimeout(2000);
    await recordBtn.click();
    const stopBtn = page.getByRole('button', { name: /stop recording/i });
    await expect(stopBtn).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(6000);
    await stopBtn.click();

    let recorded: { id?: string; durationSec?: number } | undefined;
    for (let i = 0; i < 90; i++) {
      await page.waitForTimeout(500);
      const segmentsRes = await page.request.get(`${API_BASE}/episodes/${episodeId}/segments`);
      expect(segmentsRes.ok()).toBeTruthy();
      const { segments } = await segmentsRes.json();
      recorded = segments.find(
        (s: { durationSec?: number; inProgress?: boolean; hasRecordings?: boolean; id?: string }) =>
          Boolean(s.id) &&
          s.inProgress !== true &&
          (s.hasRecordings === true || (typeof s.durationSec === 'number' && s.durationSec > 0)),
      );
      if (recorded?.id) break;
      const failToast = page.getByText(/failed to stop recording|recording produced no audio|recording failed/i);
      if (await failToast.isVisible().catch(() => false)) {
        throw new Error(`Recording failed: ${await failToast.first().textContent()}`);
      }
    }
    expect(recorded?.id).toBeTruthy();

    let lastErr: unknown;
    for (let i = 0; i < 30; i++) {
      try {
        expectPhoneSegmentFiles(podcastId, episodeId, recorded!.id!, 1);
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        await page.waitForTimeout(500);
      }
    }
    if (lastErr) throw lastErr;
  });

  test('recording with two fake phones creates two phone segments', async ({ page }) => {
    test.setTimeout(60000);
    await page.goto(`/episodes/${episodeId}`);
    await page.getByRole('button', { name: /start group call/i }).click();
    const recordBtn = page.getByRole('button', { name: /record segment/i });
    await expect(recordBtn).toBeVisible({ timeout: 20000 });
    await expect(recordBtn).toHaveAttribute('data-producer-ready', 'true', { timeout: 25000 });

    const joinCode = await readJoinCodeFromHost(page);
    await fakeDialInJoin(page.request, { joinCode, displayName: 'Phone Track 1', toneHz: 500 });
    await fakeDialInJoin(page.request, { joinCode, displayName: 'Phone Track 2', toneHz: 1200 });
    await expect(page.getByText(/Participants \(3\)/)).toBeVisible({ timeout: 15000 });

    await page.waitForTimeout(2000);
    await recordBtn.click();
    const stopBtn = page.getByRole('button', { name: /stop recording/i });
    await expect(stopBtn).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(6500);
    await stopBtn.click();

    let recorded: { id?: string } | undefined;
    for (let i = 0; i < 90; i++) {
      await page.waitForTimeout(500);
      const segmentsRes = await page.request.get(`${API_BASE}/episodes/${episodeId}/segments`);
      const { segments } = await segmentsRes.json();
      recorded = segments.find(
        (s: { durationSec?: number; inProgress?: boolean; hasRecordings?: boolean; id?: string }) =>
          Boolean(s.id) &&
          s.inProgress !== true &&
          (s.hasRecordings === true || (typeof s.durationSec === 'number' && s.durationSec > 0)),
      );
      if (recorded?.id) break;
      const failToast = page.getByText(/failed to stop recording|recording produced no audio|recording failed/i);
      if (await failToast.isVisible().catch(() => false)) {
        throw new Error(`Recording failed: ${await failToast.first().textContent()}`);
      }
    }
    expect(recorded?.id).toBeTruthy();

    let lastErr: unknown;
    for (let i = 0; i < 30; i++) {
      try {
        const result = expectPhoneSegmentFiles(podcastId, episodeId, recorded!.id!, 2);
        expect(result.phoneTracks).toBeGreaterThanOrEqual(2);
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        await page.waitForTimeout(500);
      }
    }
    if (lastErr) throw lastErr;
  });

  test('fake phone leaves and is removed from roster', async ({ page }) => {
    test.setTimeout(30000);
    await page.goto(`/episodes/${episodeId}`);
    await page.getByRole('button', { name: /start group call/i }).click();
    await expect(page.getByRole('button', { name: /record segment/i })).toBeVisible({
      timeout: 20000,
    });

    const joinCode = await readJoinCodeFromHost(page);
    const joined = await fakeDialInJoin(page.request, {
      joinCode,
      displayName: 'Leaving Phone',
    });
    await expect(page.getByText(/Participants \(2\)/)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Leaving Phone')).toBeVisible();

    await fakeDialInLeave(page.request, {
      participantId: joined.participantId,
      sessionId: joined.sessionId,
      dialInId: joined.dialInId,
    });

    await expect(page.getByText(/Participants \(1\)/)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Leaving Phone')).toHaveCount(0);
  });

  test('host kick removes fake phone from roster', async ({ page }) => {
    test.setTimeout(30000);
    await page.goto(`/episodes/${episodeId}`);
    await page.getByRole('button', { name: /start group call/i }).click();
    await expect(page.getByRole('button', { name: /record segment/i })).toBeVisible({
      timeout: 20000,
    });

    const joinCode = await readJoinCodeFromHost(page);
    await fakeDialInJoin(page.request, {
      joinCode,
      displayName: 'Kick Me Phone',
    });
    await expect(page.getByText(/Participants \(2\)/)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Kick Me Phone')).toBeVisible();

    const phoneRow = page.getByTestId('call-participant-phone').filter({ hasText: 'Kick Me Phone' });
    await phoneRow.getByRole('button', { name: /disconnect/i }).click();

    await expect(page.getByText(/Participants \(1\)/)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Kick Me Phone')).toHaveCount(0);
  });

  test('host mute pauses fake phone audio on roster', async ({ page }) => {
    test.setTimeout(30000);
    await page.goto(`/episodes/${episodeId}`);
    await page.getByRole('button', { name: /start group call/i }).click();
    await expect(page.getByRole('button', { name: /record segment/i })).toBeVisible({
      timeout: 20000,
    });

    const joinCode = await readJoinCodeFromHost(page);
    await fakeDialInJoin(page.request, {
      joinCode,
      displayName: 'Mute Me Phone',
    });
    await expect(page.getByText(/Participants \(2\)/)).toBeVisible({ timeout: 15000 });

    const phoneRow = page.getByTestId('call-participant-phone').filter({ hasText: 'Mute Me Phone' });
    await phoneRow.getByRole('button', { name: /^Mute$/i }).click();
    await expect(phoneRow.getByText(/Muted/i)).toBeVisible({ timeout: 10000 });
    await expect(phoneRow.getByRole('button', { name: /Unmute/i })).toBeVisible();
  });
});
