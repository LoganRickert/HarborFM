import { defineConfig, devices } from '@playwright/test';
import { join } from 'path';
import { existsSync } from 'fs';

const PORT = Number(process.env.E2E_PORT) || 3099;
const baseURL = `http://127.0.0.1:${PORT}`;

// File-backed fake mic produces real audio frames for mediasoup (sine wave, created by run-e2e-webrtc.sh)
const fakeMicPath = join(process.cwd(), 'assets', 'fake-mic.wav');
const fakeAudioArgs = existsSync(fakeMicPath)
  ? [
      `--use-file-for-fake-audio-capture=${fakeMicPath}`,
      '--autoplay-policy=no-user-gesture-required',
    ]
  : ['--autoplay-policy=no-user-gesture-required'];

export default defineConfig({
  testDir: './tests/webrtc',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
    permissions: ['microphone'],
    headless: false, // Headed required for reliable WebRTC fake device
    launchOptions: {
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        ...fakeAudioArgs,
      ],
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
