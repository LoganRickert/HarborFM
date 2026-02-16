/// <reference types="node" />
import { test, expect } from '@playwright/test';
import { createCallRecordingFixture, PORT } from './call-recording-helpers';

let episodeId: string;
let podcastId: string;

test.describe('Call host UI', () => {
  test.beforeEach(async ({ page }) => {
    const fixture = await createCallRecordingFixture(page);
    episodeId = fixture.episodeId;
    podcastId = fixture.podcastId;
  });

  test('Join code is visible in call panel', async ({ page }) => {
    await page.goto(`/episodes/${episodeId}`);
    await page.getByRole('button', { name: /start group call/i }).click();
    const panel = page.getByRole('region', { name: /group call/i });
    await expect(panel).toBeVisible({ timeout: 10000 });
    const joinCodeCard = panel.getByTestId('call-join-code-card');
    await expect(joinCodeCard).toBeVisible({ timeout: 5000 });
    await expect(joinCodeCard.getByText('Join code')).toBeVisible();
    const codeValue = panel.getByTestId('call-join-code-value');
    await expect(codeValue).toBeVisible();
    await expect(codeValue).toHaveText(/\d{4}/);
  });

  test('Copy join link', async ({ page }) => {
    await page.addInitScript(() => {
      if (navigator.clipboard) {
        navigator.clipboard.writeText = () => Promise.resolve();
      }
    });
    await page.goto(`/episodes/${episodeId}`);
    await page.getByRole('button', { name: /start group call/i }).click();
    const panel = page.getByRole('region', { name: /group call/i });
    await expect(panel).toBeVisible({ timeout: 10000 });
    await panel.getByRole('button', { name: /copy join link/i }).click();
    await expect(panel.getByRole('button', { name: /copied/i })).toBeVisible({ timeout: 5000 });
  });

  test('Host sees self in participants', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('harborfm_call_display_name', 'E2E Host');
    });
    await page.goto(`/episodes/${episodeId}`);
    await page.getByRole('button', { name: /start group call/i }).click();
    await expect(page.getByRole('button', { name: /record segment/i })).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(/Participants \(1\)/)).toBeVisible();
    await expect(page.getByText(/E2E Host/)).toBeVisible();
  });

  test('End Group Call button shows when call active and ends on confirm', async ({ page }) => {
    await page.goto(`/episodes/${episodeId}`);
    await page.getByRole('button', { name: /start group call/i }).click();
    await expect(page.getByRole('button', { name: /record segment/i })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: /end group call/i })).toBeVisible();
    await page.getByRole('button', { name: /end group call/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(/end group call/i);
    await dialog.getByRole('button', { name: /confirm end call/i }).click();
    await expect(page.getByRole('region', { name: /group call/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /start group call/i })).toBeVisible();
  });

  test('End call dialog Cancel keeps call active', async ({ page }) => {
    await page.goto(`/episodes/${episodeId}`);
    await page.getByRole('button', { name: /start group call/i }).click();
    await expect(page.getByRole('button', { name: /record segment/i })).toBeVisible({ timeout: 10000 });
    const panel = page.getByRole('region', { name: /group call/i });
    await panel.getByRole('button', { name: /end call/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: /cancel/i }).click();
    await expect(dialog).not.toBeVisible();
    await expect(panel).toBeVisible();
  });

  test('Minimize and maximize panel', async ({ page }) => {
    await page.goto(`/episodes/${episodeId}`);
    await page.getByRole('button', { name: /start group call/i }).click();
    const panel = page.getByRole('region', { name: /group call/i });
    await expect(panel).toBeVisible({ timeout: 10000 });
    await expect(panel.getByRole('textbox', { name: 'Join link' })).toBeVisible();
    await panel.getByRole('button', { name: /minimize/i }).click();
    await expect(panel.getByRole('textbox', { name: 'Join link' })).not.toBeVisible();
    await expect(panel.getByRole('button', { name: /record segment/i })).toBeVisible();
    await panel.getByRole('button', { name: /maximize/i }).click();
    await expect(panel.getByRole('textbox', { name: 'Join link' })).toBeVisible();
  });

  test('Host display name persists and shows in participants', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('harborfm_call_display_name', 'E2E Host');
    });
    await page.goto(`/episodes/${episodeId}`);
    await page.getByRole('button', { name: /start group call/i }).click();
    const panel = page.getByRole('region', { name: /group call/i });
    await expect(panel).toBeVisible({ timeout: 10000 });
    await expect(panel.getByText(/E2E Host/)).toBeVisible();
    await expect(panel.getByText(/Participants \(1\)/)).toBeVisible();
  });

  test('Guest joins and host sees them', async ({ page, context }) => {
    test.setTimeout(5000);
    const baseURL = `http://127.0.0.1:${PORT}`;
    await page.goto(`/episodes/${episodeId}`);
    await page.getByRole('button', { name: /start group call/i }).click();
    await expect(page.getByRole('button', { name: /record segment/i })).toBeVisible({ timeout: 20000 });

    const joinUrlRaw = await page.getByRole('textbox', { name: 'Join link' }).inputValue();
    const joinUrl = joinUrlRaw.startsWith('/') ? `${baseURL}${joinUrlRaw}` : joinUrlRaw;

    const browser = context.browser()!;
    const guestContext = await browser.newContext({ baseURL, permissions: ['microphone'] });
    const guestPage = await guestContext.newPage();
    try {
      await guestPage.goto(joinUrl);
      await guestPage.getByLabel(/your name/i).fill('E2E Guest');
      await guestPage.getByRole('button', { name: /join call/i }).click();
      await expect(guestPage.getByText(/you're in the call/i)).toBeVisible({ timeout: 15000 });

      await expect(page.getByText(/Participants \(2\)/)).toBeVisible({ timeout: 10000 });
    } finally {
      await guestContext.close();
    }
  });

  test.describe('host controls', () => {
    test('Participant list shows host first', async ({ page }) => {
      await page.addInitScript(() => {
        localStorage.setItem('harborfm_call_display_name', 'E2E Host');
      });
      await page.goto(`/episodes/${episodeId}`);
      await page.getByRole('button', { name: /start group call/i }).click();
      await expect(page.getByRole('button', { name: /record segment/i })).toBeVisible({ timeout: 20000 });
      const panel = page.getByRole('region', { name: /group call/i });
      const firstParticipant = panel.locator('ul li').first();
      await expect(firstParticipant.getByText(/E2E Host/)).toBeVisible();
    });

    test('Host can mute guest', async ({ page, context }) => {
      test.setTimeout(5000); 
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
      } finally {
        await guestContext.close();
      }
    });

    test('Host can unmute host-muted guest', async ({ page, context }) => {
      test.setTimeout(5000); 
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

        const guestUnmuteBtn = panel.locator('ul li').filter({ hasText: 'E2E Guest' }).getByRole('button', { name: 'Unmute', exact: true });
        await expect(guestUnmuteBtn).toBeEnabled();
        await guestUnmuteBtn.click();
        await expect(panel.locator('li').filter({ hasText: 'E2E Guest' }).getByText(/muted/i)).not.toBeVisible({ timeout: 5000 });
      } finally {
        await guestContext.close();
      }
    });

    test('Host can disconnect guest', async ({ page, context }) => {
      test.setTimeout(5000); 
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
        await panel.getByRole('button', { name: /disconnect/i }).click();
        await expect(page.getByText(/Participants \(1\)/)).toBeVisible({ timeout: 5000 });
      } finally {
        await guestContext.close();
      }
    });

    test('Participant cards have correct structure', async ({ page, context }) => {
      test.setTimeout(5000); 
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
        await guestPage.getByLabel(/your name/i).fill('E2E Guest');
        await guestPage.getByRole('button', { name: /join call/i }).click();
        await expect(guestPage.getByText(/you're in the call/i)).toBeVisible({ timeout: 15000 });

        const panel = page.getByRole('region', { name: /group call/i });
        await expect(panel.getByText(/E2E Host/)).toBeVisible();
        await expect(panel.getByText(/E2E Guest/)).toBeVisible();
        await expect(panel.getByText(/\(Host\)/)).toHaveCount(0);
      } finally {
        await guestContext.close();
      }
    });
  });
});
