/// <reference types="node" />
import { test, expect } from '@playwright/test';
import { createCallRecordingFixture, API_BASE } from './call-recording-helpers';
import {
  E2E_DIAL_IN_NUMBER,
  ensureDialInSettings,
  fakeDialInJoin,
  getFakeCallControl,
  getSettingsDialIn,
  readJoinCodeFromHost,
  resetDialInIvr,
} from './call-dial-in-helpers';

let episodeId: string;

test.describe('Call dial-in UI + product settings', () => {
  test.beforeEach(async ({ page }) => {
    const fixture = await createCallRecordingFixture(page);
    episodeId = fixture.episodeId;
    await resetDialInIvr(page.request);
  });

  test('admin settings round-trip for dial-in fields', async ({ page }) => {
    const before = await getSettingsDialIn(page.request);
    await ensureDialInSettings(page.request, {
      enabled: true,
      phoneNumber: '+15555559876',
      consentPrompt: 'Round-trip consent prompt.',
      telnyxApiKey: 'KEY_e2e_test_not_real',
      telnyxPublicKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      telnyxConnectionId: 'conn_e2e_123',
    });
    const after = await getSettingsDialIn(page.request);
    expect(after.dialInEnabled).toBe(true);
    expect(after.dialInPhoneNumber).toBe('+15555559876');
    expect(after.dialInConsentPrompt).toBe('Round-trip consent prompt.');
    expect(after.telnyxApiKey).toBe('(set)');
    expect(after.telnyxPublicKey).toBe('(set)');
    expect(after.telnyxConnectionId).toBe('conn_e2e_123');

    // Persist "(set)" without clearing the key
    await ensureDialInSettings(page.request, {
      enabled: true,
      phoneNumber: '+15555559876',
      consentPrompt: 'Round-trip consent prompt.',
      telnyxApiKey: '(set)',
      telnyxPublicKey: '(set)',
      telnyxConnectionId: 'conn_e2e_123',
    });
    const kept = await getSettingsDialIn(page.request);
    expect(kept.telnyxApiKey).toBe('(set)');
    expect(kept.telnyxPublicKey).toBe('(set)');

    // Restore prior values for later tests in this worker
    await ensureDialInSettings(page.request, {
      enabled: before.dialInEnabled,
      phoneNumber: before.dialInPhoneNumber || E2E_DIAL_IN_NUMBER,
      consentPrompt: before.dialInConsentPrompt || '',
      telnyxApiKey: '',
      telnyxPublicKey: '',
      telnyxConnectionId: before.telnyxConnectionId || '',
    });
  });

  test('dial-in disabled hides host card and rejects fake join', async ({ page }) => {
    await ensureDialInSettings(page.request, {
      enabled: false,
      phoneNumber: E2E_DIAL_IN_NUMBER,
    });

    await page.goto(`/episodes/${episodeId}`);
    await page.getByRole('button', { name: /start group call/i }).click();
    await expect(page.getByRole('button', { name: /record segment/i })).toBeVisible({
      timeout: 20000,
    });

    await expect(page.getByTestId('call-dial-in-card')).toHaveCount(0);
    const joinCode = await readJoinCodeFromHost(page);

    const res = await page.request.post(`${API_BASE}/call/dial-in/fake/join`, {
      data: { joinCode, displayName: 'Should Fail' },
    });
    expect(res.status()).toBe(403);
  });

  test('dial-in enabled shows host number + code card', async ({ page }) => {
    await ensureDialInSettings(page.request, {
      enabled: true,
      phoneNumber: E2E_DIAL_IN_NUMBER,
    });

    await page.goto(`/episodes/${episodeId}`);
    await page.getByRole('button', { name: /start group call/i }).click();
    await expect(page.getByRole('button', { name: /record segment/i })).toBeVisible({
      timeout: 20000,
    });

    const joinCode = await readJoinCodeFromHost(page);
    await expect(page.getByTestId('call-dial-in-card')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('call-dial-in-number')).toHaveText(E2E_DIAL_IN_NUMBER);
    await expect(page.getByTestId('call-join-code-value')).toHaveText(joinCode);
  });

  test('guest join page shows Call in instead when dial-in configured', async ({
    page,
    context,
  }) => {
    await ensureDialInSettings(page.request, {
      enabled: true,
      phoneNumber: E2E_DIAL_IN_NUMBER,
    });

    await page.goto(`/episodes/${episodeId}`);
    await page.getByRole('button', { name: /start group call/i }).click();
    await expect(page.getByRole('button', { name: /record segment/i })).toBeVisible({
      timeout: 20000,
    });

    const joinCode = await readJoinCodeFromHost(page);
    const joinUrl = await page.locator('input[aria-label="Join link"]').inputValue();
    expect(joinUrl).toContain('/call/join/');

    const guestPage = await context.newPage();
    await guestPage.goto(joinUrl);
    await expect(guestPage.getByTestId('call-join-dial-in-alt')).toBeVisible({
      timeout: 15000,
    });
    const dialNumber = guestPage.getByTestId('call-join-dial-in-number');
    await expect(dialNumber).toHaveText(E2E_DIAL_IN_NUMBER);
    await expect(guestPage.getByTestId('call-join-dial-in-code')).toHaveText(joinCode);
    await expect(dialNumber).toHaveAttribute(
      'href',
      `tel:${E2E_DIAL_IN_NUMBER},${joinCode}`,
    );
    await guestPage.close();
  });

  test('host ends call removes fake phone from roster', async ({ page }) => {
    await ensureDialInSettings(page.request);

    await page.goto(`/episodes/${episodeId}`);
    await page.getByRole('button', { name: /start group call/i }).click();
    await expect(page.getByRole('button', { name: /record segment/i })).toBeVisible({
      timeout: 20000,
    });

    const joinCode = await readJoinCodeFromHost(page);
    await fakeDialInJoin(page.request, {
      joinCode,
      displayName: 'End Call Phone',
    });
    await expect(page.getByText(/Participants \(2\)/)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('End Call Phone')).toBeVisible();

    await page.getByRole('button', { name: /end call/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await dialog.getByRole('button', { name: /confirm end call/i }).click();

    await expect(page.getByRole('button', { name: /start group call/i })).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText('End Call Phone')).toHaveCount(0);
  });

  test('fake join records consent prompt before bridge', async ({ page }) => {
    await ensureDialInSettings(page.request, {
      enabled: true,
      phoneNumber: E2E_DIAL_IN_NUMBER,
      consentPrompt: 'UI consent: recording may occur.',
    });
    await resetDialInIvr(page.request);

    await page.goto(`/episodes/${episodeId}`);
    await page.getByRole('button', { name: /start group call/i }).click();
    await expect(page.getByRole('button', { name: /record segment/i })).toBeVisible({
      timeout: 20000,
    });

    const joinCode = await readJoinCodeFromHost(page);
    await fakeDialInJoin(page.request, { joinCode, displayName: 'Consent Phone' });

    const cc = await getFakeCallControl(page.request);
    expect(
      cc.commands.some(
        (c) =>
          c.type === 'consent_prompt' &&
          typeof c.opts?.payload === 'string' &&
          c.opts.payload.includes('UI consent'),
      ),
    ).toBeTruthy();
  });
});
