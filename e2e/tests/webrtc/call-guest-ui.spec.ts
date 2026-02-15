/// <reference types="node" />
import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { createCallRecordingFixture, PORT, API_BASE, E2E_DIR } from './call-recording-helpers';

let episodeId: string;
let podcastId: string;

test.describe('CallJoin guest UI', () => {
  test.beforeEach(async ({ page }) => {
    const fixture = await createCallRecordingFixture(page);
    episodeId = fixture.episodeId;
    podcastId = fixture.podcastId;
  });

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
