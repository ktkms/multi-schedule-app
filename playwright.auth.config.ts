import { defineConfig, devices } from '@playwright/test';

const authBaseUrl = process.env.E2E_BASE_URL ?? 'http://localhost:3201';

export default defineConfig({
  testDir: './e2e',
  timeout: 30 * 1000,
  expect: {
    timeout: 5000,
  },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL: authBaseUrl,
    headless: true,
    viewport: { width: 1280, height: 720 },
    trace: 'on-first-retry',
    video: 'retain-on-failure',
    locale: 'ja-JP',
    launchOptions: {},
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: ['--lang=ja-JP', '--disable-gpu', '--no-sandbox'],
        },
      },
    },
  ],
});
