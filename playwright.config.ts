import { defineConfig } from '@playwright/test';

const port = Number(process.env.E2E_WEB_PORT ?? 5273);
const channel = process.env.E2E_BROWSER ?? (process.platform === 'win32' ? 'msedge' : 'chromium');

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './output/playwright/results',
  timeout: 90000,
  expect: { timeout: 15000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'output/playwright/report', open: 'never' }],
    ['json', { outputFile: 'output/playwright/results.json' }],
  ],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    channel,
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
    reducedMotion: 'reduce',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15000,
  },
  webServer: {
    command: 'node tests/e2e/server.mjs',
    url: `http://127.0.0.1:${port}/api/health`,
    timeout: 90000,
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe',
  },
  projects: [
    { name: 'desktop-1440', use: { viewport: { width: 1440, height: 1000 } } },
    {
      name: 'mobile-390',
      testMatch: 'layout.spec.ts',
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
    {
      name: 'narrow-320',
      testMatch: 'layout.spec.ts',
      use: { viewport: { width: 320, height: 740 }, isMobile: true, hasTouch: true },
    },
  ],
});
