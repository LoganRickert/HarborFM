/// <reference types="node" />
import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { createCallRecordingFixture, PORT, API_BASE, E2E_DIR } from './call-recording-helpers';

let episodeId: string;
let podcastId: string;

async function endCallIfActive(page: import('@playwright/test').Page) {
  console.log('[e2e cleanup] endCallIfActive start');
  const pageUrl = page.url();
  console.log('[e2e cleanup] page url:', pageUrl);
  const joinInput = page.getByRole('textbox', { name: 'Join link' });
  const joinInputVisible = await joinInput.isVisible().catch(() => false);
  console.log('[e2e cleanup] join link input visible:', joinInputVisible);
  const panel = page.getByRole('region', { name: /group call/i });
  const panelVisible = await panel.isVisible().catch(() => false);
  console.log('[e2e cleanup] panel visible:', panelVisible);
  if (!panelVisible && !joinInputVisible) return;
  const closeChatBtn = panel.getByRole('button', { name: /close chat/i });
  if (await closeChatBtn.isVisible().catch(() => false)) await closeChatBtn.click();
  const closeSoundboardBtn = panel.getByRole('button', { name: /close soundboard/i });
  if (await closeSoundboardBtn.isVisible().catch(() => false)) await closeSoundboardBtn.click();
  const endBtn = page.getByRole('button', { name: /end call|end group call/i }).first();
  if (!(await endBtn.isVisible().catch(() => false))) return;
  await endBtn.click();
  const dialog = page.getByRole('dialog');
  const dialogVisible = await dialog.isVisible();
  console.log('[e2e cleanup] dialog visible:', dialogVisible);
  if (dialogVisible) {
    await dialog.getByRole('button', { name: /confirm end call|end call/i }).click();
  }
  console.log('[e2e cleanup] endCallIfActive done');
}

test.describe('CallJoin guest UI', () => {
  test.beforeEach(async ({ page }) => {
    const fixture = await createCallRecordingFixture(page);
    episodeId = fixture.episodeId;
    podcastId = fixture.podcastId;
  });

  test.afterEach(async ({ page }) => {
    await endCallIfActive(page);
  });

  test('Leave Call shows confirm and cancelling keeps guest in call', async ({ page, context }) => {
    test.setTimeout(10000);
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
    test.setTimeout(10000);
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
    test.setTimeout(30000);
    console.log('[e2e Mute test] start episodeId=', episodeId);
    const baseURL = `http://127.0.0.1:${PORT}`;
    await page.goto(`/episodes/${episodeId}`);
    console.log('[e2e Mute test] loaded episode, clicking start');
    await page.getByRole('button', { name: /start group call/i }).click();
    await expect(page.getByRole('button', { name: /record segment/i })).toBeVisible({ timeout: 20000 });
    console.log('[e2e Mute test] host has record segment');
    const joinUrlRaw = await page.getByRole('region', { name: /group call/i }).getByRole('textbox', { name: 'Join link' }).inputValue();
    console.log('[e2e Mute test] joinUrlRaw=', joinUrlRaw);
    const joinUrl = joinUrlRaw.startsWith('/') ? `${baseURL}${joinUrlRaw}` : joinUrlRaw;

    const guestContext = await context.browser()!.newContext({ baseURL, permissions: ['microphone'] });
    const guestPage = await guestContext.newPage();
    guestPage.on('console', (msg) => {
      const text = msg.text();
      if (text.includes('[CallJoin]') || text.includes('[e2e')) console.log('[guest page]', text);
    });
    try {
      await guestPage.goto(joinUrl);
      await guestPage.getByLabel(/your name/i).fill('E2E Guest');
      await guestPage.getByRole('button', { name: /join call/i }).click();
      const errSelector = guestPage.getByText(/call is not ready|invalid or expired|connection failed/i);
      const rejected = await errSelector.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false);
      if (rejected) {
        const msg = await errSelector.textContent().catch(() => '');
        throw new Error(`Guest rejected: ${msg}. Host room creation failed - check e2e/server.log for [call]`);
      }
      await expect(guestPage.getByText(/you're in the call/i)).toBeVisible({ timeout: 5000 });
      console.log('[e2e Mute test] guest in call, checking Mute button');

      const muteBtn = guestPage.getByRole('button', { name: /^mute$/i });
      const muteDisabled = await muteBtn.getAttribute('disabled');
      console.log('[e2e Mute test] mute btn disabled attr:', muteDisabled);
      const audioUnavailableText = await guestPage.getByText(/audio is unavailable/i).isVisible().catch(() => false);
      console.log('[e2e Mute test] audio unavailable banner visible:', audioUnavailableText);
      await expect(muteBtn).toBeEnabled({ timeout: 10000 });
      console.log('[e2e Mute test] mute btn enabled, clicking');
      await muteBtn.click();
      await expect(guestPage.getByRole('button', { name: /^unmute$/i })).toBeVisible();
      await guestPage.getByRole('button', { name: /^unmute$/i }).click();
      await expect(guestPage.getByRole('button', { name: /^mute$/i })).toBeVisible();
    } finally {
      await guestContext.close();
    }
  });

  test('Host sees guest muted state', async ({ page, context }) => {
    test.setTimeout(10000);
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
      await expect(panel.locator('li').filter({ hasText: 'E2E Guest' })).toBeVisible({ timeout: 10000 });
      await panel.locator('li').filter({ hasText: 'E2E Guest' }).getByRole('button', { name: 'Mute', exact: true }).click();
      await expect(panel.locator('li').filter({ hasText: 'E2E Guest' }).getByText(/muted/i)).toBeVisible({ timeout: 5000 });
    } finally {
      await guestContext.close();
    }
  });

  test('Guest cannot unmute when host-muted', async ({ page, context }) => {
    test.setTimeout(10000);
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
    test.setTimeout(10000);
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
    test.setTimeout(30000);
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
      }
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
