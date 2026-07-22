/// <reference types="node" />
import { test, expect } from '@playwright/test';
import { createCallRecordingFixture } from './call-recording-helpers';
import {
  getDialInLeg,
  getFakeCallControl,
  ivrDialAndEnterCode,
  postDialInWebhook,
  readJoinCodeFromHost,
  resetDialInIvr,
  telnyxWebhook,
  ensureDialInSettings,
} from './call-dial-in-helpers';

let episodeId: string;

test.describe('Call dial-in IVR (webhook + Fake Call Control)', () => {
  test.beforeEach(async ({ page }) => {
    const fixture = await createCallRecordingFixture(page);
    episodeId = fixture.episodeId;
    await ensureDialInSettings(page.request);
    await resetDialInIvr(page.request);
  });

  test('no active group call rejects before answer (no welcome TTS)', async ({ page }) => {
    // Run before other tests leave live sessions in the e2e server process.
    await page.goto(`/episodes/${episodeId}`);
    await expect(page.getByRole('button', { name: /start group call/i })).toBeVisible({
      timeout: 15000,
    });

    const callControlId = `cc_nosession_${Date.now()}`;
    await postDialInWebhook(
      page.request,
      telnyxWebhook('call.initiated', {
        call_control_id: callControlId,
        from: '+15555550100',
        to: '+15555550199',
        direction: 'incoming',
        state: 'parked',
      }),
    );

    const leg = await getDialInLeg(page.request, callControlId);
    expect(leg.status).toBe('ended');
    expect(leg.pinAttempts).toBe(0);
    expect(leg.participantId).toBeFalsy();

    const cc = await getFakeCallControl(page.request);
    const forLeg = cc.commands.filter((c) => c.callControlId === callControlId);
    expect(forLeg.some((c) => c.type === 'reject')).toBeTruthy();
    expect(forLeg.some((c) => c.type === 'answer')).toBeFalsy();
    expect(forLeg.some((c) => c.type === 'speak')).toBeFalsy();
    expect(forLeg.some((c) => c.type === 'hangup')).toBeFalsy();
    expect(forLeg.some((c) => c.type === 'gather_using_speak')).toBeFalsy();
    expect(forLeg.some((c) => c.type === 'streaming_start')).toBeFalsy();
  });

  test('valid join code after gather admits phone to roster', async ({ page }) => {
    await page.goto(`/episodes/${episodeId}`);
    await page.getByRole('button', { name: /start group call/i }).click();
    await expect(page.getByRole('button', { name: /record segment/i })).toBeVisible({
      timeout: 20000,
    });

    const joinCode = await readJoinCodeFromHost(page);
    const callControlId = `cc_valid_${Date.now()}`;
    await ivrDialAndEnterCode(page.request, {
      callControlId,
      joinCode,
      from: '+15555551234',
    });

    const cc = await getFakeCallControl(page.request);
    const forLeg = cc.commands.filter((c) => c.callControlId === callControlId);
    expect(forLeg.some((c) => c.type === 'answer')).toBeTruthy();
    expect(forLeg.some((c) => c.type === 'gather_using_speak')).toBeTruthy();
    expect(forLeg.some((c) => c.type === 'streaming_start')).toBeTruthy();
    expect(forLeg.some((c) => c.type === 'hangup')).toBeFalsy();
    expect(
      forLeg.some(
        (c) =>
          c.type === 'consent_prompt' &&
          typeof c.opts?.payload === 'string' &&
          c.opts.payload.includes('E2E consent'),
      ),
    ).toBeTruthy();

    const leg = await getDialInLeg(page.request, callControlId);
    expect(leg.status).toBe('bridged');
    expect(leg.participantId).toBeTruthy();

    await expect(page.getByText(/Participants \(2\)/)).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('call-participant-phone')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Phone ...1234')).toBeVisible();
  });

  test('invalid join code retries and does not admit', async ({ page }) => {
    await page.goto(`/episodes/${episodeId}`);
    await page.getByRole('button', { name: /start group call/i }).click();
    await expect(page.getByRole('button', { name: /record segment/i })).toBeVisible({
      timeout: 20000,
    });
    await readJoinCodeFromHost(page);

    const callControlId = `cc_invalid_${Date.now()}`;
    await postDialInWebhook(
      page.request,
      telnyxWebhook('call.initiated', {
        call_control_id: callControlId,
        from: '+15555550001',
        to: '+15555550999',
        direction: 'incoming',
      }),
    );
    await postDialInWebhook(
      page.request,
      telnyxWebhook('call.gather.ended', {
        call_control_id: callControlId,
        from: '+15555550001',
        to: '+15555550999',
        digits: '0000',
        status: 'valid',
      }),
    );

    const leg = await getDialInLeg(page.request, callControlId);
    expect(leg.status).toBe('gathering');
    expect(leg.pinAttempts).toBe(1);
    expect(leg.participantId).toBeFalsy();

    const cc = await getFakeCallControl(page.request);
    const gathers = cc.commands.filter(
      (c) => c.callControlId === callControlId && c.type === 'gather_using_speak',
    );
    expect(gathers.length).toBeGreaterThanOrEqual(2);
    expect(cc.commands.some((c) => c.type === 'streaming_start')).toBeFalsy();
    expect(cc.commands.some((c) => c.type === 'hangup')).toBeFalsy();

    await expect(page.getByText(/Participants \(1\)/)).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('call-participant-phone')).toHaveCount(0);
  });

  test('expired / ended call code is rejected', async ({ page }) => {
    await page.goto(`/episodes/${episodeId}`);
    await page.getByRole('button', { name: /start group call/i }).click();
    await expect(page.getByRole('button', { name: /record segment/i })).toBeVisible({
      timeout: 20000,
    });
    const joinCode = await readJoinCodeFromHost(page);

    await page.getByRole('button', { name: /end call/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await dialog.getByRole('button', { name: /confirm end call/i }).click();
    await expect(page.getByRole('button', { name: /start group call/i })).toBeVisible({
      timeout: 15000,
    });

    // Keep a second live call so IVR still gathers; the old code must not admit.
    await page.getByRole('button', { name: /start group call/i }).click();
    await expect(page.getByRole('button', { name: /record segment/i })).toBeVisible({
      timeout: 20000,
    });
    await readJoinCodeFromHost(page);

    const callControlId = `cc_ended_${Date.now()}`;
    await ivrDialAndEnterCode(page.request, { callControlId, joinCode });

    const leg = await getDialInLeg(page.request, callControlId);
    expect(leg.status).toBe('gathering');
    expect(leg.pinAttempts).toBe(1);
    expect(leg.participantId).toBeFalsy();

    const cc = await getFakeCallControl(page.request);
    expect(
      cc.commands.some((c) => c.callControlId === callControlId && c.type === 'streaming_start'),
    ).toBeFalsy();
  });

  test('max PIN retries then hangup', async ({ page }) => {
    await page.goto(`/episodes/${episodeId}`);
    await page.getByRole('button', { name: /start group call/i }).click();
    await expect(page.getByRole('button', { name: /record segment/i })).toBeVisible({
      timeout: 20000,
    });
    await readJoinCodeFromHost(page);

    const callControlId = `cc_retries_${Date.now()}`;
    await postDialInWebhook(
      page.request,
      telnyxWebhook('call.initiated', {
        call_control_id: callControlId,
        from: '+15555550002',
        to: '+15555550999',
        direction: 'incoming',
      }),
    );

    for (const digits of ['1111', '2222', '3333']) {
      await postDialInWebhook(
        page.request,
        telnyxWebhook('call.gather.ended', {
          call_control_id: callControlId,
          from: '+15555550002',
          to: '+15555550999',
          digits,
          status: 'valid',
        }),
      );
    }

    const leg = await getDialInLeg(page.request, callControlId);
    expect(leg.status).toBe('ended');
    expect(leg.pinAttempts).toBe(3);
    expect(leg.participantId).toBeFalsy();

    const cc = await getFakeCallControl(page.request);
    const forLeg = cc.commands.filter((c) => c.callControlId === callControlId);
    expect(forLeg.some((c) => c.type === 'hangup')).toBeTruthy();
    expect(forLeg.some((c) => c.type === 'streaming_start')).toBeFalsy();
    await expect(page.getByTestId('call-participant-phone')).toHaveCount(0);
  });
});
