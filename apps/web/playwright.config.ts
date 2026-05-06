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
  timeout: 60_000,
  expect: { timeout: 10_000 },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1, // shared DB → serial
  reporter: process.env.CI ? 'github' : 'list',
  globalSetup: require.resolve('./tests/e2e/global-setup.ts'),
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    storageState: 'tests/e2e/.auth/admin.json',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    // Inline env vars in the command so they override .env.local values that
    // Next.js loads from disk (Next gives process.env priority, but explicit
    // shell-set vars are the most reliable across platforms).
    command:
      "DATABASE_URL='postgresql://giper:giper@localhost:5433/giper_pm_test' " +
      "AUTH_SECRET='test-secret-please-change-only-for-tests' " +
      `AUTH_URL='${BASE_URL}' ` +
      "AUTH_TRUST_HOST='true' " +
      `next dev --port ${PORT}`,
    url: BASE_URL,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    env: {
      DATABASE_URL: 'postgresql://giper:giper@localhost:5433/giper_pm_test',
      AUTH_SECRET: 'test-secret-please-change-only-for-tests',
      AUTH_URL: BASE_URL,
      AUTH_TRUST_HOST: 'true',
    },
  },
});
