/// <reference types="node" />
import { test, expect } from '@playwright/test';
import { createCallRecordingFixture } from './call-recording-helpers';
import {
  fetchDialInCallLogs,
  ivrDialAndEnterCode,
  postDialInWebhook,
  readJoinCodeFromHost,
  resetDialInIvr,
  telnyxWebhook,
  ensureDialInSettings,
} from './call-dial-in-helpers';

let episodeId: string;

test.describe('Call dial-in call logs', () => {
  test.beforeEach(async ({ page }) => {
    const fixture = await createCallRecordingFixture(page);
    episodeId = fixture.episodeId;
    await ensureDialInSettings(page.request);
    await resetDialInIvr(page.request);
  });

  test('rejected_no_call is persisted and listed', async ({ page }) => {
    await page.goto(`/episodes/${episodeId}`);
    await expect(page.getByRole('button', { name: /start group call/i })).toBeVisible({
      timeout: 15000,
    });

    const callControlId = `cc_log_reject_${Date.now()}`;
    const from = '+15555550111';
    await postDialInWebhook(
      page.request,
      telnyxWebhook('call.initiated', {
        call_control_id: callControlId,
        call_leg_id: callControlId,
        call_session_id: `sess_${callControlId}`,
        from,
        to: '+15555550199',
        direction: 'incoming',
        state: 'parked',
      }),
    );

    await expect
      .poll(async () => {
        const calls = await fetchDialInCallLogs(page.request, 10);
        return calls.find((c) => c.callControlId === callControlId) ?? null;
      }, { timeout: 10000 })
      .toMatchObject({
        callControlId,
        fromNumber: from,
        outcome: 'rejected_no_call',
      });

    const row = (await fetchDialInCallLogs(page.request, 10)).find(
      (c) => c.callControlId === callControlId,
    );
    expect(row?.endedAt).toBeTruthy();
  });

  test('successful bridge + hangup is logged as bridged', async ({ page }) => {
    await page.goto(`/episodes/${episodeId}`);
    await page.getByRole('button', { name: /start group call/i }).click();
    await expect(page.getByRole('button', { name: /record segment/i })).toBeVisible({
      timeout: 20000,
    });

    const joinCode = await readJoinCodeFromHost(page);
    const callControlId = `cc_log_bridge_${Date.now()}`;
    const from = '+15555551234';
    await ivrDialAndEnterCode(page.request, {
      callControlId,
      joinCode,
      from,
    });

    await expect
      .poll(async () => {
        const calls = await fetchDialInCallLogs(page.request, 10);
        return calls.find((c) => c.callControlId === callControlId)?.outcome ?? null;
      }, { timeout: 15000 })
      .toBe('bridged');

    await postDialInWebhook(
      page.request,
      telnyxWebhook('call.hangup', {
        call_control_id: callControlId,
        call_leg_id: callControlId,
        call_session_id: `sess_${callControlId}`,
        from,
        to: '+15555550999',
        hangup_cause: 'normal_clearing',
        sip_hangup_cause: '16',
        hangup_source: 'caller',
        state: 'hangup',
      }),
    );

    await expect
      .poll(async () => {
        const calls = await fetchDialInCallLogs(page.request, 10);
        const row = calls.find((c) => c.callControlId === callControlId);
        return row?.hangupCause ?? null;
      }, { timeout: 10000 })
      .toBe('normal_clearing');

    const logged = (await fetchDialInCallLogs(page.request, 10)).find(
      (c) => c.callControlId === callControlId,
    );
    expect(logged?.outcome).toBe('bridged');
    expect(logged?.joinCode).toBe(joinCode);
    expect(logged?.fromNumber).toBe(from);
    expect(logged?.endedAt).toBeTruthy();
    expect(logged?.sessionId).toBeTruthy();
    expect(logged?.durationMs == null || logged.durationMs >= 0).toBeTruthy();
  });

  test('settings WebRTC shows recent dial-in feed', async ({ page }) => {
    const callControlId = `cc_log_ui_${Date.now()}`;
    const from = '+15555550987';
    await postDialInWebhook(
      page.request,
      telnyxWebhook('call.initiated', {
        call_control_id: callControlId,
        from,
        to: '+15555550199',
        direction: 'incoming',
        state: 'parked',
      }),
    );

    await page.goto('/settings');
    await page.getByRole('tab', { name: /^WebRTC$/i }).click();
    await expect(page.getByTestId('dial-in-call-logs')).toBeVisible({ timeout: 15000 });

    const byAttr = page.locator(
      `[data-testid="dial-in-call-log-item"][data-call-control-id="${callControlId}"]`,
    );
    await expect(byAttr).toBeVisible({ timeout: 15000 });
    await expect(byAttr).toHaveAttribute('data-outcome', 'rejected_no_call');
    await expect(byAttr).toContainText(from);
    await expect(byAttr).toContainText('No live call');
  });
});
