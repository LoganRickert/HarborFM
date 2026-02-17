/// <reference types="node" />
import { test, expect } from '@playwright/test';
import { createCallRecordingFixture, PORT } from './call-recording-helpers';

let episodeId: string;
let podcastId: string;

test.describe('Call join flow', () => {
  test.beforeEach(async ({ page }) => {
    const fixture = await createCallRecordingFixture(page);
    episodeId = fixture.episodeId;
    podcastId = fixture.podcastId;
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
      test.setTimeout(35000);
      const baseURL = `http://127.0.0.1:${PORT}`;
      await page.goto(`${baseURL}/episodes/${episodeId}`);
      await page.getByRole('button', { name: /start group call/i }).click();
      await expect(page.getByRole('button', { name: /record segment/i })).toBeVisible({ timeout: 20000 });
      const joinCodeValue = page.getByRole('region', { name: /group call/i }).getByTestId('call-join-code-value');
      await expect(joinCodeValue).toBeVisible({ timeout: 5000 });
      const code = await joinCodeValue.textContent();
      expect(code).toMatch(/^\d{4}$/);
      await page.waitForTimeout(1500);

      const guestContext = await context.browser()!.newContext({ baseURL });
      const loginTab = await guestContext.newPage();
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
        await guestContext.close();
      }
    });
  });

  test('Host joining own code from Dashboard sees already connected', async ({ page, context }) => {
    test.setTimeout(35000);
    const baseURL = `http://127.0.0.1:${PORT}`;

    await page.goto(`${baseURL}/episodes/${episodeId}`);
    await page.getByRole('button', { name: /start group call/i }).click();
    await expect(page.getByRole('button', { name: /record segment/i })).toBeVisible({ timeout: 20000 });
    const joinCodeValue = page.getByRole('region', { name: /group call/i }).getByTestId('call-join-code-value');
    await expect(joinCodeValue).toBeVisible({ timeout: 5000 });
    const code = await joinCodeValue.textContent();
    expect(code).toMatch(/^\d{4}$/);
    await page.waitForTimeout(1500);

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

      await expect(dialog.getByText(/you're already connected/i)).toBeVisible({ timeout: 5000 });
      const goToCallLink = dialog.getByRole('link', { name: /go to call/i });
      await expect(goToCallLink).toBeVisible();

      await goToCallLink.click();
      await expect(dashboardTab).toHaveURL(new RegExp(`/episodes/${episodeId}`), { timeout: 5000 });
    } finally {
      await dashboardTab.close();
    }
  });

  test('Guest joining via code from Dashboard navigates to join page', async ({ page, context }) => {
    test.setTimeout(35000);
    const baseURL = `http://127.0.0.1:${PORT}`;

    await page.goto(`${baseURL}/episodes/${episodeId}`);
    await page.getByRole('button', { name: /start group call/i }).click();
    await expect(page.getByRole('button', { name: /record segment/i })).toBeVisible({ timeout: 20000 });
    const joinCodeValue = page.getByRole('region', { name: /group call/i }).getByTestId('call-join-code-value');
    await expect(joinCodeValue).toBeVisible({ timeout: 5000 });
    const code = await joinCodeValue.textContent();
    expect(code).toMatch(/^\d{4}$/);
    await page.waitForTimeout(1500);

    const guestContext = await context.browser()!.newContext({ baseURL });
    const guestPage = await guestContext.newPage();
    try {
      await guestPage.goto(`${baseURL}/login`);
      await expect(guestPage.getByRole('button', { name: /join call/i })).toBeVisible({ timeout: 10000 });
      await guestPage.getByRole('button', { name: /join call/i }).click();
      const dialog = guestPage.getByRole('dialog');
      await expect(dialog).toBeVisible({ timeout: 5000 });
      await dialog.getByRole('textbox', { name: /4-digit join code/i }).fill(code!);
      await dialog.getByRole('button', { name: /^join$/i }).click();

      await expect(guestPage).toHaveURL(new RegExp(`/call/join/`), { timeout: 10000 });
      await expect(guestPage.getByLabel(/your name/i)).toBeVisible({ timeout: 5000 });
    } finally {
      await guestContext.close();
    }
  });
});
