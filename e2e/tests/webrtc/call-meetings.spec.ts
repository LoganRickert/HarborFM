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

function localDatetimeOffset(msFromNow: number): string {
  const d = new Date(Date.now() + msFromNow);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

test.describe('Scheduled group call meetings', () => {
  test.beforeEach(async ({ page }) => {
    const fixture = await createCallRecordingFixture(page);
    episodeId = fixture.episodeId;
  });

  test('Schedule Meeting dialog creates meeting; Start Meeting and ad-hoc remain separate', async ({
    page,
  }) => {
    test.setTimeout(60000);
    await page.goto(`/episodes/${episodeId}`);

    await expect(page.getByRole('button', { name: /start group call/i })).toBeVisible({
      timeout: 25000,
    });
    await expect(page.getByRole('button', { name: /schedule meeting/i })).toBeVisible();

    await page.getByRole('button', { name: /schedule meeting/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(dialog.getByRole('heading', { name: /^schedule meeting$/i })).toBeVisible();

    await dialog.locator('#meeting-start').fill(localDatetimeOffset(30 * 60 * 1000));
    await dialog.getByRole('button', { name: /^schedule$/i }).click();

    await expect(dialog.getByRole('heading', { name: /^meeting$/i })).toBeVisible({ timeout: 15000 });
    await expect(dialog.getByTestId('meeting-join-code')).toBeVisible();

    // Email invite
    await dialog.getByPlaceholder('Name', { exact: true }).fill('UI Guest');
    await dialog.getByPlaceholder('Email').fill(`ui-guest-${Date.now()}@e2e.test`);
    await dialog.getByRole('button', { name: /send email/i }).click();
    await expect(dialog.getByTestId('meeting-emailed-invites')).toBeVisible({ timeout: 10000 });
    await expect(dialog.getByText(/UI Guest/)).toBeVisible();

    // Copy link
    await page.addInitScript(() => {
      if (navigator.clipboard) {
        navigator.clipboard.writeText = () => Promise.resolve();
      }
    });
    await dialog.getByRole('button', { name: /copy link/i }).click();
    await expect(dialog.getByRole('button', { name: /^copied$/i })).toBeVisible({ timeout: 5000 });

    await dialog.locator('footer').getByRole('button', { name: /^close$/i }).click();
    await expect(dialog).not.toBeVisible();

    await expect(page.getByRole('button', { name: /manage meeting/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /start meeting/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /start group call/i })).toBeVisible();

    // Ad-hoc start still works and opens call panel
    await page.getByRole('button', { name: /start group call/i }).click();
    await expect(page.getByRole('region', { name: /group call/i })).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('button', { name: /end group call/i })).toBeVisible();

    // Start Meeting should not be usable while ad-hoc call is active (button may be hidden)
    await expect(page.getByRole('button', { name: /start meeting/i })).toHaveCount(0);
  });

  test('Start Meeting opens call with reserved code; guest waits until host starts', async ({
    page,
    context,
  }) => {
    test.setTimeout(90000);
    const csrf = await csrfFromPage(page);
    const scheduledStartAt = new Date(Date.now() + 25 * 60 * 1000).toISOString();

    const createRes = await page.request.post(`${API_BASE}/call/meetings`, {
      headers: { 'x-csrf-token': csrf },
      data: { episodeId, scheduledStartAt },
    });
    expect(createRes.ok()).toBeTruthy();
    const created = await createRes.json();
    const meeting = created.meeting as {
      id: string;
      joinCode: string;
      token: string;
      joinUrl: string;
    };
    expect(meeting.joinCode).toMatch(/^\d{4}$/);

    const inviteRes = await page.request.post(`${API_BASE}/call/meetings/${meeting.id}/invites`, {
      headers: { 'x-csrf-token': csrf },
      data: { name: 'Prefill Name', email: null },
    });
    expect(inviteRes.ok()).toBeTruthy();
    const inviteBody = await inviteRes.json();
    const guestUrl = String(inviteBody.joinUrl);

    const baseURL = `http://127.0.0.1:${PORT}`;
    const guestContext = await context.browser()!.newContext({ baseURL });
    const guestPage = await guestContext.newPage();
    try {
      const pathOrUrl = guestUrl.startsWith('http')
        ? guestUrl
        : `${baseURL}${guestUrl.startsWith('/') ? '' : '/'}${guestUrl}`;
      await guestPage.goto(pathOrUrl);
      await expect(
        guestPage.getByText(/host hasn't started the meeting yet/i),
      ).toBeVisible({
        timeout: 15000,
      });
      await expect(guestPage.getByRole('button', { name: /waiting for host/i })).toBeDisabled();
      const nameInput = guestPage.getByLabel(/your name/i);
      await expect(nameInput).toHaveValue('Prefill Name');

      // Host starts the scheduled meeting
      await page.goto(`/episodes/${episodeId}`);
      await expect(page.getByRole('button', { name: /start meeting/i })).toBeVisible({
        timeout: 25000,
      });
      await page.getByRole('button', { name: /start meeting/i }).click();
      await expect(page.getByRole('region', { name: /group call/i })).toBeVisible({ timeout: 25000 });
      const codeValue = page.getByRole('region', { name: /group call/i }).getByTestId('call-join-code-value');
      await expect(codeValue).toHaveText(meeting.joinCode);

      // Guest polls; wait up to ~45s for status flip (poll interval 30s)
      await expect(guestPage.getByRole('button', { name: /^join call$/i })).toBeEnabled({
        timeout: 45000,
      });
      await expect(guestPage.getByText(/host hasn't started the meeting yet/i)).toHaveCount(0);
    } finally {
      await guestContext.close();
    }
  });

  test('Cancel meeting from manage dialog', async ({ page }) => {
    test.setTimeout(45000);
    const csrf = await csrfFromPage(page);
    const createRes = await page.request.post(`${API_BASE}/call/meetings`, {
      headers: { 'x-csrf-token': csrf },
      data: {
        episodeId,
        scheduledStartAt: new Date(Date.now() + 40 * 60 * 1000).toISOString(),
      },
    });
    expect(createRes.ok()).toBeTruthy();

    await page.goto(`/episodes/${episodeId}`);
    await page.getByRole('button', { name: /manage meeting/i }).click();
    const dialog = page.getByRole('dialog', { name: /^Meeting$/ });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: /cancel meeting/i }).click();
    const confirm = page.getByRole('dialog', { name: /cancel meeting\?/i });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: /confirm cancel meeting/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: /schedule meeting/i })).toBeVisible({
      timeout: 10000,
    });
  });

  test('too_early join page message for meeting outside window', async ({ page, context }) => {
    test.setTimeout(45000);
    const csrf = await csrfFromPage(page);
    const createRes = await page.request.post(`${API_BASE}/call/meetings`, {
      headers: { 'x-csrf-token': csrf },
      data: {
        episodeId,
        scheduledStartAt: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
      },
    });
    expect(createRes.ok()).toBeTruthy();
    const meeting = (await createRes.json()).meeting as { token: string; joinUrl: string };

    const baseURL = `http://127.0.0.1:${PORT}`;
    const guestContext = await context.browser()!.newContext({ baseURL });
    const guestPage = await guestContext.newPage();
    try {
      await guestPage.goto(`${baseURL}/call/join/${meeting.token}`);
      await expect(guestPage.getByText(/opens .+ before the scheduled start/i)).toBeVisible({
        timeout: 15000,
      });
      await expect(guestPage.getByRole('button', { name: /join call/i })).toHaveCount(0);
    } finally {
      await guestContext.close();
    }
  });
});
