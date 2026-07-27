/// <reference types="node" />
import { test, expect } from '@playwright/test';
import { createCallRecordingFixture, PORT, API_BASE } from './call-recording-helpers';

let episodeId: string;

async function csrfFromPage(page: import('@playwright/test').Page): Promise<string> {
  const state = await page.context().storageState();
  const csrf = state.cookies.find((c) => c.name === 'harborfm_csrf')?.value;
  if (!csrf) throw new Error('No CSRF cookie');
  return csrf;
}

test.describe('Meeting guest topics', () => {
  test.beforeEach(async ({ page }) => {
    const fixture = await createCallRecordingFixture(page);
    episodeId = fixture.episodeId;
  });

  test('topics page with invite, CallJoin link, name gate, host quick-add, cancel lockout', async ({
    page,
    context,
  }) => {
    test.setTimeout(120000);
    const csrf = await csrfFromPage(page);
    const scheduledStartAt = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();

    const createRes = await page.request.post(`${API_BASE}/call/meetings`, {
      headers: { 'x-csrf-token': csrf },
      data: { episodeId, scheduledStartAt },
    });
    expect(createRes.ok()).toBeTruthy();
    const meeting = (await createRes.json()).meeting as {
      id: string;
      token: string;
      joinUrl: string;
    };

    const inviteRes = await page.request.post(`${API_BASE}/call/meetings/${meeting.id}/invites`, {
      headers: { 'x-csrf-token': csrf },
      data: { name: 'UI Topics Guest', email: `ui-topics-${Date.now()}@e2e.test` },
    });
    expect(inviteRes.ok()).toBeTruthy();
    const inviteBody = await inviteRes.json();
    const inviteToken = inviteBody.invite.inviteToken as string;
    expect(inviteBody.joinUrl).toContain('invite=');

    const baseURL = `http://127.0.0.1:${PORT}`;
    const guestContext = await context.browser()!.newContext({ baseURL });
    const guestPage = await guestContext.newPage();
    try {
      await guestPage.goto(`${baseURL}/call/join/${meeting.token}`);
      await expect(guestPage.getByText(/This meeting starts/i)).toBeVisible({ timeout: 15000 });
      const suggest = guestPage.getByRole('link', { name: /suggest topics/i });
      await expect(suggest).toBeVisible();
      await expect(suggest).toHaveAttribute('href', new RegExp(`/call/join/${meeting.token}/topics`));

      await guestPage.goto(
        `${baseURL}/call/join/${meeting.token}/topics?invite=${encodeURIComponent(inviteToken)}`,
      );
      await expect(guestPage.getByRole('heading', { name: /suggest topics/i })).toBeVisible({
        timeout: 15000,
      });
      await expect(guestPage.getByLabel(/your name/i)).toHaveCount(0);
      await guestPage.getByLabel(/new topic/i).fill('Discuss weather');
      await guestPage.getByRole('button', { name: /^to discuss$/i }).click();
      await guestPage.getByRole('button', { name: /^add topic$/i }).click();
      await expect(guestPage.getByText('Discuss weather')).toBeVisible({ timeout: 10000 });

      await guestPage.getByLabel(/new topic/i).fill('Avoid spoilers');
      await guestPage.getByRole('button', { name: /^to avoid$/i }).click();
      await guestPage.getByRole('button', { name: /^add topic$/i }).click();
      await expect(guestPage.getByText('Avoid spoilers')).toBeVisible({ timeout: 10000 });
    } finally {
      await guestContext.close();
    }

    // Name-gate path (no invite)
    const nameContext = await context.browser()!.newContext({ baseURL });
    const namePage = await nameContext.newPage();
    try {
      await namePage.goto(`${baseURL}/call/join/${meeting.token}/topics`);
      await expect(namePage.getByLabel(/your name/i)).toBeVisible({ timeout: 15000 });
      await namePage.getByLabel(/your name/i).fill('Alex');
      await namePage.getByRole('button', { name: /^continue$/i }).click();
      await namePage.getByLabel(/new topic/i).fill('Alex discuss');
      await namePage.getByRole('button', { name: /^add topic$/i }).click();
      await expect(namePage.getByText('Alex discuss')).toBeVisible({ timeout: 10000 });
      await expect(namePage.getByText('Discuss weather')).toHaveCount(0);
    } finally {
      await nameContext.close();
    }

    // Host Show Notes: submitted topics + quick add
    await page.goto(`/episodes/${episodeId}`);
    await expect(page.getByRole('heading', { name: /show notes/i })).toBeVisible({
      timeout: 20000,
    });
    const showNotesToggle = page.getByRole('button', { name: /show show notes|hide show notes/i });
    if ((await showNotesToggle.getAttribute('aria-expanded')) === 'false') {
      await showNotesToggle.click();
    }
    await expect(page.getByRole('heading', { name: /^submitted topics$/i })).toBeVisible();
    await expect(page.getByText(/Submitted by/i).first()).toBeVisible();
    await expect(page.getByText('Discuss weather')).toBeVisible();
    await page.getByRole('button', { name: /^add to notes$/i }).first().click();
    await expect(page.getByRole('heading', { name: /^notes$/i })).toBeVisible();
    // Promoted into Notes; gone from Submitted topics
    await expect(page.getByRole('button', { name: /^add to notes$/i })).toHaveCount(0, {
      timeout: 10000,
    });
    await expect(page.locator('textarea').first()).toHaveValue(/Discuss weather/);

    // Cancel lockout
    await page.request.post(`${API_BASE}/call/meetings/${meeting.id}/cancel`, {
      headers: { 'x-csrf-token': csrf },
    });
    const closedContext = await context.browser()!.newContext({ baseURL });
    const closedPage = await closedContext.newPage();
    try {
      await closedPage.goto(
        `${baseURL}/call/join/${meeting.token}/topics?invite=${encodeURIComponent(inviteToken)}`,
      );
      await expect(closedPage.getByText(/cancelled|ended|expired/i)).toBeVisible({
        timeout: 15000,
      });
      await expect(closedPage.getByRole('button', { name: /^add topic$/i })).toHaveCount(0);

      await closedPage.goto(`${baseURL}/call/join/${meeting.token}`);
      await expect(closedPage.getByRole('link', { name: /suggest topics/i })).toHaveCount(0);
    } finally {
      await closedContext.close();
    }
  });
});
