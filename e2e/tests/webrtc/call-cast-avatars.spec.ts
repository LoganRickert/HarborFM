/// <reference types="node" />
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { test, expect } from '@playwright/test';
import { createCallRecordingFixture, PORT, API_BASE, E2E_DIR } from './call-recording-helpers';

const PHOTO_URL = 'https://example.com/cast-photo.jpg';

/** 1x1 PNG so external photoUrl does not fail onError in the roster. */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function mockCastPhotoUrl(page: import('@playwright/test').Page) {
  await page.route('https://example.com/cast-photo.jpg', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: TINY_PNG,
    });
  });
}

let episodeId: string;
let podcastId: string;

async function csrfFromPage(page: import('@playwright/test').Page): Promise<string> {
  const state = await page.context().storageState();
  const csrf = state.cookies.find((c) => c.name === 'harborfm_csrf')?.value;
  if (!csrf) throw new Error('No CSRF cookie');
  return csrf;
}

async function endCallIfActive(page: import('@playwright/test').Page) {
  const panel = page.getByRole('region', { name: /group call/i });
  if (!(await panel.isVisible().catch(() => false))) return;
  const endBtn = page.getByRole('button', { name: /end call|end group call/i }).first();
  if (!(await endBtn.isVisible().catch(() => false))) return;
  await endBtn.click();
  const dialog = page.getByRole('dialog');
  if (await dialog.isVisible().catch(() => false)) {
    await dialog.getByRole('button', { name: /confirm end call|end call/i }).click();
  }
}

async function createCast(
  page: import('@playwright/test').Page,
  body: {
    name: string;
    role?: 'host' | 'guest';
    photoUrl?: string | null;
    isPublic?: 0 | 1;
    email?: string;
  },
): Promise<{ id: string; name: string }> {
  const csrf = await csrfFromPage(page);
  const res = await page.request.post(`${API_BASE}/podcasts/${podcastId}/cast`, {
    headers: { 'x-csrf-token': csrf },
    data: {
      name: body.name,
      role: body.role ?? 'guest',
      photoUrl: body.photoUrl ?? null,
      isPublic: body.isPublic ?? 1,
      email: body.email,
    },
  });
  expect(res.ok()).toBeTruthy();
  const cast = (await res.json()) as { id: string; name: string };
  return cast;
}

async function startAdHocCall(page: import('@playwright/test').Page): Promise<string> {
  await page.goto(`/episodes/${episodeId}`);
  await page.getByRole('button', { name: /start group call/i }).click();
  await expect(page.getByRole('button', { name: /record segment/i })).toBeVisible({
    timeout: 20000,
  });
  const joinUrlRaw = await page
    .getByRole('region', { name: /group call/i })
    .getByRole('textbox', { name: 'Join link' })
    .inputValue();
  const baseURL = `http://127.0.0.1:${PORT}`;
  return joinUrlRaw.startsWith('/') ? `${baseURL}${joinUrlRaw}` : joinUrlRaw;
}

async function guestJoin(
  context: import('@playwright/test').BrowserContext,
  joinUrl: string,
  name: string,
): Promise<import('@playwright/test').Page> {
  const baseURL = `http://127.0.0.1:${PORT}`;
  const guestContext = await context.browser()!.newContext({
    baseURL,
    permissions: ['microphone'],
  });
  const guestPage = await guestContext.newPage();
  (guestPage as import('@playwright/test').Page & { __guestContext?: typeof guestContext }).__guestContext =
    guestContext;
  await guestPage.goto(joinUrl);
  await guestPage.getByLabel(/your name/i).fill(name);
  await guestPage.getByRole('button', { name: /join call/i }).click();
  await expect(guestPage.getByText(/you're in the call/i)).toBeVisible({ timeout: 15000 });
  return guestPage;
}

async function closeGuest(guestPage: import('@playwright/test').Page) {
  const ctx = (
    guestPage as import('@playwright/test').Page & {
      __guestContext?: import('@playwright/test').BrowserContext;
    }
  ).__guestContext;
  if (ctx) await ctx.close();
  else await guestPage.close();
}

test.describe('Call cast roster avatars', () => {
  test.beforeEach(async ({ page }) => {
    const fixture = await createCallRecordingFixture(page);
    episodeId = fixture.episodeId;
    podcastId = fixture.podcastId;
  });

  test.afterEach(async ({ page }) => {
    await endCallIfActive(page);
  });

  test('public cast name match shows photo on host roster', async ({ page, context }) => {
    test.setTimeout(60000);
    await mockCastPhotoUrl(page);
    await createCast(page, {
      name: 'Alex Cast',
      photoUrl: PHOTO_URL,
      isPublic: 1,
    });

    const joinUrl = await startAdHocCall(page);
    const guestPage = await guestJoin(context, joinUrl, 'Alex Cast');
    try {
      await mockCastPhotoUrl(guestPage);
      const row = page
        .getByRole('region', { name: /group call/i })
        .locator('li')
        .filter({ hasText: 'Alex Cast' });
      await expect(row).toBeVisible({ timeout: 15000 });
      const photo = row.getByTestId('call-participant-cast-photo');
      await expect(photo).toBeVisible();
      await expect(photo).toHaveAttribute('src', PHOTO_URL);
    } finally {
      await closeGuest(guestPage);
    }
  });

  test('private cast name match does not show photo', async ({ page, context }) => {
    test.setTimeout(60000);
    await createCast(page, {
      name: 'Secret Cast',
      photoUrl: PHOTO_URL,
      isPublic: 0,
    });

    const joinUrl = await startAdHocCall(page);
    const guestPage = await guestJoin(context, joinUrl, 'Secret Cast');
    try {
      const row = page
        .getByRole('region', { name: /group call/i })
        .locator('li')
        .filter({ hasText: 'Secret Cast' });
      await expect(row).toBeVisible({ timeout: 15000 });
      await expect(row.getByTestId('call-participant-cast-photo')).toHaveCount(0);
    } finally {
      await closeGuest(guestPage);
    }
  });

  test('invite-bound cast photo survives rename', async ({ page, context }) => {
    test.setTimeout(120000);
    await mockCastPhotoUrl(page);
    const csrf = await csrfFromPage(page);
    const cast = await createCast(page, {
      name: 'Invite Locked',
      photoUrl: PHOTO_URL,
      isPublic: 0,
      email: `invite-locked-${Date.now()}@e2e.test`,
    });

    const scheduledStartAt = new Date(Date.now() + 25 * 60 * 1000).toISOString();
    const createRes = await page.request.post(`${API_BASE}/call/meetings`, {
      headers: { 'x-csrf-token': csrf },
      data: { episodeId, scheduledStartAt },
    });
    expect(createRes.ok()).toBeTruthy();
    const meeting = (await createRes.json()).meeting as { id: string; token: string };

    const inviteRes = await page.request.post(`${API_BASE}/call/meetings/${meeting.id}/invites`, {
      headers: { 'x-csrf-token': csrf },
      data: {
        name: cast.name,
        email: `invite-locked-${Date.now()}@e2e.test`,
        castId: cast.id,
      },
    });
    expect(inviteRes.ok()).toBeTruthy();
    const inviteBody = await inviteRes.json();
    const inviteToken = inviteBody.invite.inviteToken as string;
    const guestJoinUrl = String(inviteBody.joinUrl);

    await page.goto(`/episodes/${episodeId}`);
    await expect(page.getByRole('button', { name: /start meeting/i })).toBeVisible({
      timeout: 25000,
    });
    await page.getByRole('button', { name: /start meeting/i }).click();
    await expect(page.getByRole('region', { name: /group call/i })).toBeVisible({
      timeout: 25000,
    });

    const baseURL = `http://127.0.0.1:${PORT}`;
    const guestContext = await context.browser()!.newContext({
      baseURL,
      permissions: ['microphone'],
    });
    const guestPage = await guestContext.newPage();
    await mockCastPhotoUrl(guestPage);
    try {
      const pathOrUrl = guestJoinUrl.startsWith('http')
        ? guestJoinUrl
        : `${baseURL}${guestJoinUrl.startsWith('/') ? '' : '/'}${guestJoinUrl}`;
      // Ensure invite query is present
      const withInvite = pathOrUrl.includes('invite=')
        ? pathOrUrl
        : `${pathOrUrl}${pathOrUrl.includes('?') ? '&' : '?'}invite=${encodeURIComponent(inviteToken)}`;
      await guestPage.goto(withInvite);
      await expect(guestPage.getByRole('button', { name: /^join call$/i })).toBeEnabled({
        timeout: 45000,
      });
      await guestPage.getByRole('button', { name: /^join call$/i }).click();
      await expect(guestPage.getByText(/you're in the call/i)).toBeVisible({ timeout: 15000 });

      const row = page
        .getByRole('region', { name: /group call/i })
        .locator('li')
        .filter({ hasText: 'Invite Locked' });
      await expect(row.getByTestId('call-participant-cast-photo')).toBeVisible({ timeout: 15000 });
      await expect(row.getByTestId('call-participant-cast-photo')).toHaveAttribute(
        'src',
        PHOTO_URL,
      );

      // Rename on guest side
      await guestPage.getByRole('button', { name: /edit your name/i }).click();
      const nameInput = guestPage.getByPlaceholder(/your name/i);
      await nameInput.fill('Renamed Guest');
      await nameInput.press('Enter');

      const renamedRow = page
        .getByRole('region', { name: /group call/i })
        .locator('li')
        .filter({ hasText: 'Renamed Guest' });
      await expect(renamedRow).toBeVisible({ timeout: 15000 });
      await expect(renamedRow.getByTestId('call-participant-cast-photo')).toBeVisible();
      await expect(renamedRow.getByTestId('call-participant-cast-photo')).toHaveAttribute(
        'src',
        PHOTO_URL,
      );
    } finally {
      await guestContext.close();
    }
  });

  test('private uploaded cast photo is served only while invitee is in live call', async ({
    page,
    context,
  }) => {
    test.setTimeout(120000);
    const csrf = await csrfFromPage(page);
    const artworkPath = join(E2E_DIR, 'test-data', 'favicon.png');
    if (!existsSync(artworkPath)) throw new Error('favicon.png not found');

    const cast = await createCast(page, {
      name: 'Private Photo Cast',
      isPublic: 0,
      email: `private-photo-${Date.now()}@e2e.test`,
    });

    const uploadRes = await page.request.post(
      `${API_BASE}/podcasts/${podcastId}/cast/${cast.id}/photo`,
      {
        headers: { 'x-csrf-token': csrf },
        multipart: {
          file: {
            name: 'favicon.png',
            mimeType: 'image/png',
            buffer: readFileSync(artworkPath),
          },
        },
      },
    );
    expect(uploadRes.ok()).toBeTruthy();
    const uploaded = (await uploadRes.json()) as { photoFilename?: string | null };
    const filename = uploaded.photoFilename;
    expect(filename).toBeTruthy();
    const artworkUrl = `${API_BASE}/public/artwork/${podcastId}/cast/${cast.id}/${encodeURIComponent(filename!)}`;

    const before = await page.request.get(artworkUrl);
    expect(before.status()).toBe(404);

    const scheduledStartAt = new Date(Date.now() + 25 * 60 * 1000).toISOString();
    const createRes = await page.request.post(`${API_BASE}/call/meetings`, {
      headers: { 'x-csrf-token': csrf },
      data: { episodeId, scheduledStartAt },
    });
    expect(createRes.ok()).toBeTruthy();
    const meeting = (await createRes.json()).meeting as { id: string };

    const inviteRes = await page.request.post(`${API_BASE}/call/meetings/${meeting.id}/invites`, {
      headers: { 'x-csrf-token': csrf },
      data: {
        name: cast.name,
        email: `private-photo-${Date.now()}@e2e.test`,
        castId: cast.id,
      },
    });
    expect(inviteRes.ok()).toBeTruthy();
    const inviteBody = await inviteRes.json();
    const inviteToken = inviteBody.invite.inviteToken as string;
    const guestJoinUrl = String(inviteBody.joinUrl);

    await page.goto(`/episodes/${episodeId}`);
    await page.getByRole('button', { name: /start meeting/i }).click();
    await expect(page.getByRole('region', { name: /group call/i })).toBeVisible({
      timeout: 25000,
    });

    const baseURL = `http://127.0.0.1:${PORT}`;
    const guestContext = await context.browser()!.newContext({
      baseURL,
      permissions: ['microphone'],
    });
    const guestPage = await guestContext.newPage();
    try {
      const pathOrUrl = guestJoinUrl.startsWith('http')
        ? guestJoinUrl
        : `${baseURL}${guestJoinUrl.startsWith('/') ? '' : '/'}${guestJoinUrl}`;
      const withInvite = pathOrUrl.includes('invite=')
        ? pathOrUrl
        : `${pathOrUrl}${pathOrUrl.includes('?') ? '&' : '?'}invite=${encodeURIComponent(inviteToken)}`;
      await guestPage.goto(withInvite);
      await expect(guestPage.getByRole('button', { name: /^join call$/i })).toBeEnabled({
        timeout: 45000,
      });
      await guestPage.getByRole('button', { name: /^join call$/i }).click();
      await expect(guestPage.getByText(/you're in the call/i)).toBeVisible({ timeout: 15000 });

      const during = await page.request.get(artworkUrl);
      expect(during.status()).toBe(200);

      await guestPage.getByRole('button', { name: /leave call/i }).click();
      const leaveDialog = guestPage.getByRole('dialog');
      if (await leaveDialog.isVisible().catch(() => false)) {
        await leaveDialog.getByRole('button', { name: /confirm leave call|leave call/i }).click();
      }
      await expect
        .poll(async () => (await page.request.get(artworkUrl)).status(), { timeout: 15000 })
        .toBe(404);
    } finally {
      await guestContext.close();
    }
  });
});
