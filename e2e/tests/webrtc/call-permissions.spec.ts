/// <reference types="node" />
import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const E2E_DIR = join(__dirname, '../..');
const PORT = Number(process.env.E2E_PORT) || 3099;
const API_BASE = `http://127.0.0.1:${PORT}/api`;
const DATA_DIR = process.env.E2E_DATA_DIR || join(E2E_DIR, 'data');

function getSetupToken(): string | null {
  const path = join(DATA_DIR, 'setup-token.txt');
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf8').trim();
}

async function loginAs(page: import('@playwright/test').Page, email: string, password: string) {
  const res = await page.request.post(`${API_BASE}/auth/login`, {
    data: { email, password },
  });
  if (!res.ok()) {
    const text = await res.text();
    throw new Error(`Login failed: ${res.status()} ${text}`);
  }
}

async function logout(page: import('@playwright/test').Page) {
  await page.request.post(`${API_BASE}/auth/logout`);
}

/** Login via UI to ensure session cookies are in page context (needed for GET /users admin access). Requires no existing session - call logout() first if switching users. */
async function loginAsViaPage(page: import('@playwright/test').Page, email: string, password: string) {
  console.log('[loginAsViaPage] Navigating to /login...');
  await page.goto('/login');
  console.log('[loginAsViaPage] URL after goto:', page.url());
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  console.log('[loginAsViaPage] Submitted, waiting for redirect...');
  await expect(page).toHaveURL(/\/(?!login)/, { timeout: 10000 });
  await page.waitForLoadState('networkidle');
  console.log('[loginAsViaPage] Done. URL:', page.url());
}

async function getCsrf(page: import('@playwright/test').Page): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const state = await page.context().storageState();
    const csrf = state.cookies.find((c) => c.name === 'harborfm_csrf')?.value;
    if (csrf) return csrf;
    const cookieNames = state.cookies.map((c) => c.name).join(', ');
    console.log(`[getCsrf] attempt ${i + 1}: no harborfm_csrf. Cookies: [${cookieNames}]`);
    await page.waitForTimeout(200);
  }
  const state = await page.context().storageState();
  console.log('[getCsrf] FAILED. All cookies:', JSON.stringify(state.cookies, null, 2));
  throw new Error('No CSRF cookie - session may not have been established');
}

test.describe('Call permissions', () => {
  test.beforeEach(async ({ page }) => {
    const token = getSetupToken();
    if (token) {
      await page.request.post(`${API_BASE}/setup/complete?id=${encodeURIComponent(token)}`, {
        data: {
          email: 'admin@e2e.test',
          password: 'admin-password-123',
          hostname: `http://localhost:${PORT}`,
          registration_enabled: true,
          public_feeds_enabled: true,
          import_pixabay_assets: false,
        },
      });
    }
  });

  test('Editor can start call and see Record segment', async ({ page }) => {
    test.setTimeout(45000);
    console.log('[Editor test] Going to / and logging in as admin...');
    await page.goto('/');
    await loginAs(page, 'admin@e2e.test', 'admin-password-123');
    const csrf = await getCsrf(page);

    console.log('[Editor test] Creating podcast...');
    const podcastRes = await page.request.post(`${API_BASE}/podcasts`, {
      headers: { 'x-csrf-token': csrf },
      data: { title: 'E2E Perm Show', slug: `e2e-perm-${Date.now()}`, description: '' },
    });
    if (!podcastRes.ok()) throw new Error('Create podcast failed');
    const podcast = await podcastRes.json();
    console.log('[Editor test] Created podcast:', podcast.id);

    const episodeRes = await page.request.post(`${API_BASE}/podcasts/${podcast.id}/episodes`, {
      headers: { 'x-csrf-token': csrf },
      data: { title: 'E2E Perm Episode', description: '', status: 'draft' },
    });
    if (!episodeRes.ok()) throw new Error('Create episode failed');
    const episode = await episodeRes.json();
    console.log('[Editor test] Created episode:', episode.id);

    const editorEmail = `editor-perm-${Date.now()}@e2e.test`;
    const editorPassword = 'editor-password-123';
    console.log('[Editor test] Registering editor:', editorEmail);
    const regRes = await page.request.post(`${API_BASE}/auth/register`, {
      data: { email: editorEmail, password: editorPassword },
    });
    if (!regRes.ok()) throw new Error(`Register failed: ${regRes.status()} ${await regRes.text()}`);
    console.log('[Editor test] Registered. Re-logging in as admin (register may have changed session)...');
    await loginAs(page, 'admin@e2e.test', 'admin-password-123');
    const csrfAfterReg = await getCsrf(page);
    console.log('[Editor test] Got CSRF, adding as collaborator...');

    const collabRes = await page.request.post(`${API_BASE}/podcasts/${podcast.id}/collaborators`, {
      headers: { 'x-csrf-token': csrfAfterReg },
      data: { email: editorEmail, role: 'editor' },
    });
    if (!collabRes.ok()) {
      const body = await collabRes.text();
      console.log('[Editor test] Add collaborator FAILED:', collabRes.status(), body);
      throw new Error(`Add collaborator failed: ${collabRes.status()} ${body}`);
    }
    console.log('[Editor test] Added editor collaborator, logging out...');

    await logout(page);
    console.log('[Editor test] Logged out, logging in as editor via UI...');
    await loginAsViaPage(page, editorEmail, editorPassword);
    await page.goto(`/episodes/${episode.id}`);

    console.log('[Editor test] Navigated to episode. URL:', page.url(), 'Title:', await page.title());
    const allButtons = await page.getByRole('button').allTextContents();
    console.log('[Editor test] Visible buttons:', allButtons);
    const pageText = await page.locator('body').innerText();
    console.log('[Editor test] Page text (first 500 chars):', pageText.slice(0, 500));

    await expect(page.getByRole('button', { name: /start group call/i })).toBeVisible({ timeout: 20000 });
    await page.getByRole('button', { name: /start group call/i }).click();
    await expect(page.getByRole('button', { name: /record segment/i })).toBeVisible({ timeout: 20000 });
  });

  test('View collaborator cannot start call', async ({ page }) => {
    await page.goto('/');
    await loginAs(page, 'admin@e2e.test', 'admin-password-123');
    const csrf = await getCsrf(page);

    const podcastRes = await page.request.post(`${API_BASE}/podcasts`, {
      headers: { 'x-csrf-token': csrf },
      data: { title: 'E2E View Show', slug: `e2e-view-${Date.now()}`, description: '' },
    });
    if (!podcastRes.ok()) throw new Error('Create podcast failed');
    const podcast = await podcastRes.json();

    const episodeRes = await page.request.post(`${API_BASE}/podcasts/${podcast.id}/episodes`, {
      headers: { 'x-csrf-token': csrf },
      data: { title: 'E2E View Episode', description: '', status: 'draft' },
    });
    if (!episodeRes.ok()) throw new Error('Create episode failed');
    const episode = await episodeRes.json();

    const viewEmail = `view-perm-${Date.now()}@e2e.test`;
    const viewPassword = 'view-password-123';
    await page.request.post(`${API_BASE}/auth/register`, {
      data: { email: viewEmail, password: viewPassword },
    });

    await page.request.post(`${API_BASE}/podcasts/${podcast.id}/collaborators`, {
      headers: { 'x-csrf-token': csrf },
      data: { email: viewEmail, role: 'view' },
    });

    await loginAs(page, viewEmail, viewPassword);
    await page.goto(`/episodes/${episode.id}`);

    await expect(page.getByRole('button', { name: /start group call/i })).not.toBeVisible();

    const startRes = await page.request.post(`${API_BASE}/call/start`, {
      data: { episodeId: episode.id },
    });
    expect(startRes.status()).toBe(403);
  });

  test('Read-only user cannot start call', async ({ page }) => {
    console.log('[Read-only] Establishing session via API login...');
    await page.goto('/');
    await loginAs(page, 'admin@e2e.test', 'admin-password-123');
    const csrf = await getCsrf(page);
    console.log('[Read-only] Got CSRF, creating podcast...');

    const podcastRes = await page.request.post(`${API_BASE}/podcasts`, {
      headers: { 'x-csrf-token': csrf },
      data: { title: 'E2E RO Show', slug: `e2e-ro-${Date.now()}`, description: '' },
    });
    if (!podcastRes.ok()) throw new Error('Create podcast failed');
    const podcast = await podcastRes.json();

    const episodeRes = await page.request.post(`${API_BASE}/podcasts/${podcast.id}/episodes`, {
      headers: { 'x-csrf-token': csrf },
      data: { title: 'E2E RO Episode', description: '', status: 'draft' },
    });
    if (!episodeRes.ok()) throw new Error('Create episode failed');
    const episode = await episodeRes.json();

    const roEmail = `ro-perm-${Date.now()}@e2e.test`;
    const roPassword = 'ro-password-123';
    await page.request.post(`${API_BASE}/auth/register`, {
      data: { email: roEmail, password: roPassword },
    });
    await loginAs(page, 'admin@e2e.test', 'admin-password-123');

    console.log('[Read-only] GET /users...');
    const usersRes = await page.request.get(`${API_BASE}/users?limit=100&search=${encodeURIComponent(roEmail)}`);
    if (!usersRes.ok()) {
      const body = await usersRes.text();
      console.log('[Read-only] GET /users FAILED:', usersRes.status(), body);
      throw new Error(`Get users failed: ${usersRes.status()} ${body}`);
    }
    const usersData = await usersRes.json();
    const roUser = usersData.users?.find((u: { email: string }) => u.email === roEmail);
    if (!roUser) throw new Error('User not found');

    await page.request.patch(`${API_BASE}/users/${roUser.id}`, {
      headers: { 'x-csrf-token': csrf },
      data: { read_only: true },
    });

    await page.request.post(`${API_BASE}/podcasts/${podcast.id}/collaborators`, {
      headers: { 'x-csrf-token': csrf },
      data: { email: roEmail, role: 'editor' },
    });

    await loginAs(page, roEmail, roPassword);
    await page.goto(`/episodes/${episode.id}`);

    await expect(page.getByRole('button', { name: /start group call/i })).not.toBeVisible();

    const startRes = await page.request.post(`${API_BASE}/call/start`, {
      data: { episodeId: episode.id },
    });
    expect(startRes.status()).toBe(403);
  });

  test('Disabled user cannot log in', async ({ page }) => {
    console.log('[Disabled] Establishing session via API login...');
    await page.goto('/');
    await loginAs(page, 'admin@e2e.test', 'admin-password-123');
    const csrf = await getCsrf(page);
    console.log('[Disabled] Got CSRF, registering user...');

    const disEmail = `dis-perm-${Date.now()}@e2e.test`;
    const disPassword = 'dis-password-123';
    await page.request.post(`${API_BASE}/auth/register`, {
      data: { email: disEmail, password: disPassword },
    });
    await loginAs(page, 'admin@e2e.test', 'admin-password-123');

    console.log('[Disabled] GET /users...');
    const usersRes = await page.request.get(`${API_BASE}/users?limit=100&search=${encodeURIComponent(disEmail)}`);
    if (!usersRes.ok()) {
      const body = await usersRes.text();
      console.log('[Disabled] GET /users FAILED:', usersRes.status(), body);
      throw new Error(`Get users failed: ${usersRes.status()} ${body}`);
    }
    const usersData = await usersRes.json();
    const disUser = usersData.users?.find((u: { email: string }) => u.email === disEmail);
    if (!disUser) throw new Error('User not found');

    const adminCsrf = await getCsrf(page);
    await page.request.patch(`${API_BASE}/users/${disUser.id}`, {
      headers: { 'x-csrf-token': adminCsrf },
      data: { disabled: true },
    });

    const loginRes = await page.request.post(`${API_BASE}/auth/login`, {
      data: { email: disEmail, password: disPassword },
    });
    expect(loginRes.status()).toBe(403);
  });

  test('Owner can start and stop recording', async ({ page }) => {
    test.setTimeout(60000);
    await page.goto('/');
    await loginAs(page, 'admin@e2e.test', 'admin-password-123');
    const csrf = await getCsrf(page);

    const podcastRes = await page.request.post(`${API_BASE}/podcasts`, {
      headers: { 'x-csrf-token': csrf },
      data: { title: 'E2E Record Show', slug: `e2e-record-${Date.now()}`, description: '' },
    });
    if (!podcastRes.ok()) throw new Error('Create podcast failed');
    const podcast = await podcastRes.json();

    const episodeRes = await page.request.post(`${API_BASE}/podcasts/${podcast.id}/episodes`, {
      headers: { 'x-csrf-token': csrf },
      data: { title: 'E2E Record Episode', description: '', status: 'draft' },
    });
    if (!episodeRes.ok()) throw new Error('Create episode failed');
    const episode = await episodeRes.json();

    await page.addInitScript(() => {
      localStorage.setItem('harborfm_call_display_name', 'E2E Host');
    });
    await page.goto(`/episodes/${episode.id}`);
    await page.getByRole('button', { name: /start group call/i }).click();

    const recordBtn = page.getByRole('button', { name: /record segment/i });
    await expect(recordBtn).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(5000);
    await recordBtn.click();
    await page.waitForTimeout(3000);
    await expect(page.getByRole('button', { name: /stop recording/i })).toBeVisible({ timeout: 5000 });
    await page.getByRole('button', { name: /stop recording/i }).click();
    await expect(page.getByText(/recording stopped successfully/i)).toBeVisible({ timeout: 15000 });
  });

  test('Guest has no Record button', async ({ page, context }) => {
    test.setTimeout(45000);
    const baseURL = `http://127.0.0.1:${PORT}`;
    await page.goto('/');
    await loginAs(page, 'admin@e2e.test', 'admin-password-123');
    const csrf = await getCsrf(page);

    const podcastRes = await page.request.post(`${API_BASE}/podcasts`, {
      headers: { 'x-csrf-token': csrf },
      data: { title: 'E2E Guest Show', slug: `e2e-guest-${Date.now()}`, description: '' },
    });
    if (!podcastRes.ok()) throw new Error('Create podcast failed');
    const podcast = await podcastRes.json();

    const episodeRes = await page.request.post(`${API_BASE}/podcasts/${podcast.id}/episodes`, {
      headers: { 'x-csrf-token': csrf },
      data: { title: 'E2E Guest Episode', description: '', status: 'draft' },
    });
    if (!episodeRes.ok()) throw new Error('Create episode failed');
    const episode = await episodeRes.json();

    await page.addInitScript(() => {
      localStorage.setItem('harborfm_call_display_name', 'E2E Host');
    });
    await page.goto(`/episodes/${episode.id}`);
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

      await expect(guestPage.getByRole('button', { name: /record segment/i })).not.toBeVisible();
    } finally {
      await guestContext.close();
    }
  });
});

test.describe('Call storage limits', () => {
  test.beforeEach(async ({ page }) => {
    const token = getSetupToken();
    if (token) {
      await page.request.post(`${API_BASE}/setup/complete?id=${encodeURIComponent(token)}`, {
        data: {
          email: 'admin@e2e.test',
          password: 'admin-password-123',
          hostname: `http://localhost:${PORT}`,
          registration_enabled: true,
          public_feeds_enabled: true,
          import_pixabay_assets: false,
        },
      });
    }
  });

  test('Start Group Call disabled when owner out of disk', async ({ page }) => {
    if (!existsSync(join(E2E_DIR, 'test-data', '20260212_133813_rXR9IQ1yujd-cq4JYRNCY.mp3'))) {
      test.skip(true, 'test-data mp3 not found');
    }
    console.log('[Storage-1] Establishing session via API login...');
    await page.goto('/');
    await loginAs(page, 'admin@e2e.test', 'admin-password-123');
    const csrf = await getCsrf(page);
    console.log('[Storage-1] Got CSRF, registering owner...');

    const ownerEmail = `storage-owner-${Date.now()}@e2e.test`;
    const ownerPassword = 'owner-password-123';
    await page.request.post(`${API_BASE}/auth/register`, {
      data: { email: ownerEmail, password: ownerPassword },
    });
    await loginAs(page, 'admin@e2e.test', 'admin-password-123');

    console.log('[Storage-1] GET /users...');
    const usersRes = await page.request.get(`${API_BASE}/users?limit=100&search=${encodeURIComponent(ownerEmail)}`);
    if (!usersRes.ok()) {
      const body = await usersRes.text();
      console.log('[Storage-1] GET /users FAILED:', usersRes.status(), body);
      throw new Error(`Get users failed: ${usersRes.status()} ${body}`);
    }
    const usersData = await usersRes.json();
    const ownerUser = usersData.users?.find((u: { email: string }) => u.email === ownerEmail);
    if (!ownerUser) throw new Error('User not found');
    console.log('[Storage-1] Found owner, logging in as owner...');

    await loginAs(page, ownerEmail, ownerPassword);
    const ownerCsrf = await getCsrf(page);
    console.log('[Storage-1] Creating podcast, uploading...');

    const podcastRes = await page.request.post(`${API_BASE}/podcasts`, {
      headers: { 'x-csrf-token': ownerCsrf },
      data: { title: 'E2E Storage Show', slug: `e2e-storage-${Date.now()}`, description: '' },
    });
    if (!podcastRes.ok()) throw new Error('Create podcast failed');
    const podcast = await podcastRes.json();

    const buf = readFileSync(join(E2E_DIR, 'test-data', '20260212_133813_rXR9IQ1yujd-cq4JYRNCY.mp3'));
    let firstEpisodeId: string | null = null;
    for (let i = 1; i <= 7; i++) {
      const epRes = await page.request.post(`${API_BASE}/podcasts/${podcast.id}/episodes`, {
        headers: { 'x-csrf-token': ownerCsrf },
        data: { title: `E2E Episode ${i}`, description: '', status: 'draft' },
      });
      if (!epRes.ok()) throw new Error('Create episode failed');
      const ep = await epRes.json();
      if (i === 1) firstEpisodeId = ep.id;
      const uploadRes = await page.request.post(`${API_BASE}/episodes/${ep.id}/audio`, {
        headers: { 'x-csrf-token': ownerCsrf },
        multipart: { file: { name: 'audio.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from(buf) } },
      });
      if (!uploadRes.ok()) throw new Error(`Upload failed: ${uploadRes.status()}`);
    }

    await loginAs(page, 'admin@e2e.test', 'admin-password-123');
    const adminCsrf = await getCsrf(page);
    await page.request.patch(`${API_BASE}/users/${ownerUser.id}`, {
      headers: { 'x-csrf-token': adminCsrf },
      data: { max_storage_mb: 1 },
    });

    await loginAs(page, ownerEmail, ownerPassword);
    const episodeRes = await page.request.get(`${API_BASE}/podcasts/${podcast.id}/episodes?limit=1`);
    if (!episodeRes.ok()) throw new Error('Get episodes failed');
    const episodesData = await episodeRes.json();
    const episode = episodesData.episodes?.[0] ?? (firstEpisodeId ? { id: firstEpisodeId } : null);
    if (!episode) throw new Error('No episode');

    await page.goto(`/episodes/${episode.id}`);
    await expect(page.getByRole('button', { name: /edit episode details/i })).toBeVisible({ timeout: 15000 });
    const startBtn = page.getByRole('button', { name: /start group call/i });
    await expect(startBtn).toBeVisible({ timeout: 5000 });
    await expect(startBtn).toBeDisabled();
    await expect(startBtn).toHaveAttribute('title', 'You are out of disk space');
  });

  test('Record segment disabled when owner out of disk', async ({ page }) => {
    test.setTimeout(60000);
    if (!existsSync(join(E2E_DIR, 'test-data', '20260212_133813_rXR9IQ1yujd-cq4JYRNCY.mp3'))) {
      test.skip(true, 'test-data mp3 not found');
    }
    console.log('[Storage-2] Establishing session via API login...');
    await page.goto('/');
    await loginAs(page, 'admin@e2e.test', 'admin-password-123');
    const csrf = await getCsrf(page);
    console.log('[Storage-2] Got CSRF...');

    const ownerEmail = `storage-owner2-${Date.now()}@e2e.test`;
    const ownerPassword = 'owner-password-123';
    await page.request.post(`${API_BASE}/auth/register`, {
      data: { email: ownerEmail, password: ownerPassword },
    });
    await loginAs(page, 'admin@e2e.test', 'admin-password-123');

    console.log('[Storage-2] GET /users...');
    const usersRes = await page.request.get(`${API_BASE}/users?limit=100&search=${encodeURIComponent(ownerEmail)}`);
    if (!usersRes.ok()) {
      const body = await usersRes.text();
      console.log('[Storage-2] GET /users FAILED:', usersRes.status(), body);
      throw new Error(`Get users failed: ${usersRes.status()} ${body}`);
    }
    const usersData = await usersRes.json();
    const ownerUser = usersData.users?.find((u: { email: string }) => u.email === ownerEmail);
    if (!ownerUser) throw new Error('User not found');
    console.log('[Storage-2] Found owner, logging in...');

    await loginAs(page, ownerEmail, ownerPassword);
    const ownerCsrf = await getCsrf(page);
    console.log('[Storage-2] Creating podcast, uploading 7 episodes...');

    const podcastRes = await page.request.post(`${API_BASE}/podcasts`, {
      headers: { 'x-csrf-token': ownerCsrf },
      data: { title: 'E2E Storage Show 2', slug: `e2e-storage2-${Date.now()}`, description: '' },
    });
    if (!podcastRes.ok()) throw new Error('Create podcast failed');
    const podcast = await podcastRes.json();

    const buf = readFileSync(join(E2E_DIR, 'test-data', '20260212_133813_rXR9IQ1yujd-cq4JYRNCY.mp3'));
    let lastEpisodeId: string | null = null;
    for (let i = 1; i <= 7; i++) {
      const epRes = await page.request.post(`${API_BASE}/podcasts/${podcast.id}/episodes`, {
        headers: { 'x-csrf-token': ownerCsrf },
        data: { title: `E2E Episode ${i}`, description: '', status: 'draft' },
      });
      if (!epRes.ok()) throw new Error('Create episode failed');
      const ep = await epRes.json();
      lastEpisodeId = ep.id;
      const uploadRes = await page.request.post(`${API_BASE}/episodes/${ep.id}/audio`, {
        headers: { 'x-csrf-token': ownerCsrf },
        multipart: { file: { name: 'audio.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from(buf) } },
      });
      if (!uploadRes.ok()) throw new Error(`Upload failed: ${uploadRes.status()}`);
    }

    const editorEmail = `storage-editor-${Date.now()}@e2e.test`;
    const editorPassword = 'editor-password-123';
    await page.request.post(`${API_BASE}/auth/register`, {
      data: { email: editorEmail, password: editorPassword },
    });
    await loginAs(page, ownerEmail, ownerPassword);
    const ownerCsrfForCollab = await getCsrf(page);

    await page.request.post(`${API_BASE}/podcasts/${podcast.id}/collaborators`, {
      headers: { 'x-csrf-token': ownerCsrfForCollab },
      data: { email: editorEmail, role: 'editor' },
    });

    await loginAs(page, 'admin@e2e.test', 'admin-password-123');
    const adminCsrf = await getCsrf(page);
    await page.request.patch(`${API_BASE}/users/${ownerUser.id}`, {
      headers: { 'x-csrf-token': adminCsrf },
      data: { max_storage_mb: 1 },
    });

    await loginAs(page, editorEmail, editorPassword);

    if (!lastEpisodeId) throw new Error('No episode created');

    await page.addInitScript(() => {
      localStorage.setItem('harborfm_call_display_name', 'E2E Editor');
    });
    await page.goto(`/episodes/${lastEpisodeId}`);
    const startBtn = page.getByRole('button', { name: /start group call/i });
    await expect(startBtn).toBeVisible({ timeout: 15000 });
    await startBtn.click();
    const panel = page.getByRole('region', { name: /group call/i });
    await expect(panel).toBeVisible({ timeout: 15000 });
    const recordBtn = panel.getByRole('button', { name: /record segment/i });
    await expect(recordBtn).toBeVisible({ timeout: 10000 });
    await expect(recordBtn).toBeDisabled();
  });
});
