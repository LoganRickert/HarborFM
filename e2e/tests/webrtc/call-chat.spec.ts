/// <reference types="node" />
import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.E2E_PORT) || 3099;
const API_BASE = `http://127.0.0.1:${PORT}/api`;
const E2E_DIR = join(__dirname, '../..');
const DATA_DIR = process.env.E2E_DATA_DIR || join(E2E_DIR, 'data');

let episodeId: string;
let podcastId: string;

function getSetupToken(): string | null {
  const path = join(DATA_DIR, 'setup-token.txt');
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf8').trim();
}

test.describe('Call chat', () => {
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

    const loginRes = await page.request.post(`${API_BASE}/auth/login`, {
      data: { email: 'admin@e2e.test', password: 'admin-password-123' },
    });
    if (!loginRes.ok()) {
      const text = await loginRes.text();
      throw new Error(`Login failed: ${loginRes.status()} ${text}`);
    }

    const state = await page.context().storageState();
    const csrf = state.cookies.find((c) => c.name === 'harborfm_csrf')?.value;
    if (!csrf) throw new Error('No CSRF cookie after login');

    const podcastRes = await page.request.post(`${API_BASE}/podcasts`, {
      headers: { 'x-csrf-token': csrf },
      data: {
        title: 'E2E Chat Show',
        slug: `e2e-chat-${Date.now()}`,
        description: '',
      },
    });
    if (!podcastRes.ok()) throw new Error('Create podcast failed');
    const podcast = await podcastRes.json();

    const episodeRes = await page.request.post(`${API_BASE}/podcasts/${podcast.id}/episodes`, {
      headers: { 'x-csrf-token': csrf },
      data: {
        title: 'E2E Chat Episode',
        description: '',
        status: 'draft',
      },
    });
    if (!episodeRes.ok()) throw new Error('Create episode failed');
    const episode = await episodeRes.json();
    episodeId = episode.id;
    podcastId = podcast.id;
  });

  test('Chat button visible in CallPanel when call active', async ({ page }) => {
    await page.goto(`/episodes/${episodeId}`);
    await page.getByRole('button', { name: /start group call/i }).click();
    await expect(page.getByRole('button', { name: /record segment/i })).toBeVisible({ timeout: 20000 });
    const chatBtn = page.getByTestId('chat-open-btn');
    await expect(chatBtn).toBeVisible();
  });

  test('Chat panel visible in CallJoin when guest joined', async ({ page, context }) => {
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

      const chatPanel = guestPage.getByTestId('chat-panel');
      await expect(chatPanel).toBeVisible();
    } finally {
      await guestContext.close();
    }
  });

  test('Host sends chat message, guest sees it', async ({ page, context }) => {
    test.setTimeout(45000);
    const baseURL = `http://127.0.0.1:${PORT}`;
    await page.addInitScript(() => {
      localStorage.setItem('harborfm_call_display_name', 'E2E Host');
    });
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

      // Host opens chat and sends message
      const hostChatBtn = page.getByTestId('chat-open-btn');
      await hostChatBtn.click();
      await expect(page.getByTestId('chat-panel')).toBeVisible();
      await page.getByTestId('chat-input').fill('Hello from host!');
      await page.getByTestId('chat-send').click();

      // Guest chat is always visible; expand if minimized, then assert message
      const guestChatPanel = guestPage.getByTestId('chat-panel');
      await expect(guestChatPanel).toBeVisible();
      const maxBtn = guestChatPanel.getByRole('button', { name: /maximize/i });
      if (await maxBtn.isVisible()) await maxBtn.click();
      await expect(guestPage.getByText('Hello from host!')).toBeVisible({ timeout: 5000 });
      await expect(guestPage.getByTestId('chat-message-list').getByText('E2E Host')).toBeVisible();
    } finally {
      await guestContext.close();
    }
  });

  test('Guest sends chat message, host sees it', async ({ page, context }) => {
    test.setTimeout(45000);
    const baseURL = `http://127.0.0.1:${PORT}`;
    await page.addInitScript(() => {
      localStorage.setItem('harborfm_call_display_name', 'E2E Host');
    });
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

      // Guest chat is always visible; expand if minimized, then send message
      const guestChatPanel = guestPage.getByTestId('chat-panel');
      await expect(guestChatPanel).toBeVisible();
      const maxBtn = guestChatPanel.getByRole('button', { name: /maximize/i });
      if (await maxBtn.isVisible()) await maxBtn.click();
      await guestPage.getByTestId('chat-input').fill('Hello from guest!');
      await guestPage.getByTestId('chat-send').click();

      // Host opens chat and sees message
      await page.getByTestId('chat-open-btn').click();
      await expect(page.getByTestId('chat-panel')).toBeVisible();
      await expect(page.getByText('Hello from guest!')).toBeVisible({ timeout: 5000 });
      await expect(page.getByTestId('chat-message-list').getByText('E2E Guest')).toBeVisible();
    } finally {
      await guestContext.close();
    }
  });

  test('Chat panel minimize and maximize', async ({ page }) => {
    await page.goto(`/episodes/${episodeId}`);
    await page.getByRole('button', { name: /start group call/i }).click();
    await expect(page.getByRole('button', { name: /record segment/i })).toBeVisible({ timeout: 20000 });

    await page.getByTestId('chat-open-btn').click();
    const chatPanel = page.getByTestId('chat-panel');
    await expect(chatPanel).toBeVisible();
    await expect(chatPanel.getByTestId('chat-message-list')).toBeVisible();

    await chatPanel.getByRole('button', { name: /minimize/i }).click();
    await expect(chatPanel.getByTestId('chat-message-list')).not.toBeVisible();

    await chatPanel.getByRole('button', { name: /maximize/i }).click();
    await expect(chatPanel.getByTestId('chat-message-list')).toBeVisible();
  });
});
