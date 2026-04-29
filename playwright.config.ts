import { defineConfig, devices } from '@playwright/test';

process.env.APP_VARIANT = process.env.APP_VARIANT || 'stage';

/**
 * GasTech Mobile — Playwright Configuration
 *
 * Targets the Expo web build (expo start --web).
 * Runs on the QA branch before merging to production.
 *
 * Docs: https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  // Where all test files live
  testDir: './tests',

  // Match any file ending in .spec.ts
  testMatch: '**/*.spec.ts',

  // Max time one test can run (ms)
  timeout: 120_000,

  // Max time the whole test suite can run (ms) – 10 minutes
  globalTimeout: 600_000,

  // Retry failed tests once in CI to reduce flakiness from timing issues
  retries: process.env.CI ? 1 : 0,

  // Run tests sequentially using 1 worker.
  // This ensures a single shared Expo web server is used — running multiple
  // workers on Windows causes Metro watcher crashes (ENOENT on .gradle paths).
  workers: 1,

  // Reporter output
  reporter: [
    ['list'],                         // Console output
    ['html', { open: 'never' }],      // HTML report in playwright-report/
    ['json', { outputFile: 'test-results/results.json' }],
  ],

  // Shared settings for all test files
  use: {
    // Expo web dev server URL
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:8081',

    // Always collect traces on first retry – helps debug CI failures
    trace: 'on-first-retry',

    // Screenshot on failure
    screenshot: 'only-on-failure',

    // Video recording on failure
    video: 'retain-on-failure',

    // Default navigation timeout
    navigationTimeout: 30_000,

    // Default action timeout (click, fill, etc.)
    actionTimeout: 15_000,
  },

  // Browsers to run against
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    // Mobile viewport – simulates a phone screen in the browser
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
    },
  ],

  // Automatically start the Expo web server before tests run.
  // Remove this block if you prefer to start the server manually.
  webServer: {
    command: 'npx expo start --web --port 8081 --no-dev --clear',
    url: 'http://localhost:8081',
    timeout: 180_000,         // Allow 3 min for Expo to bundle (first run is slow)
    reuseExistingServer: true,   // Always reuse — avoids duplicate server crashes
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
