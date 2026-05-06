import { defineConfig, devices } from '@playwright/test';

const PORT = process.env.PORT ?? '3100';
const BASE_URL = `http://localhost:${PORT}`;

/**
 * E2E suite. Runs against a dedicated dev server on port 3100 with the test DB.
 * webServer is started by Playwright; tests log in via UI and reuse storage.
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /.*\.e2e\.ts$/,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1, // shared DB → serial
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'pnpm dev -- --port ' + PORT,
    url: BASE_URL,
    timeout: 60_000,
    reuseExistingServer: !process.env.CI,
    env: {
      DATABASE_URL: 'postgresql://giper:giper@localhost:5433/giper_pm_test',
      AUTH_SECRET: 'test-secret-please-change-only-for-tests',
      AUTH_URL: BASE_URL,
      AUTH_TRUST_HOST: 'true',
    },
  },
});
