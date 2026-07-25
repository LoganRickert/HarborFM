import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT) || 3099;
const baseURL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './tests/editor',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
    actionTimeout: 20000,
    // Headed matches webrtc suite reliability on this host; xvfb-run when no DISPLAY.
    headless: false,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
