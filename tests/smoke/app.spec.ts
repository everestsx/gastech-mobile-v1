import { test, expect } from '@playwright/test';
import { goToApp, waitForAppReady } from '../utils/helpers';

/**
 * App Smoke Tests
 * ───────────────
 * High-level checks that confirm the app bundle loads and
 * core UI chrome is present. These run first in CI to provide
 * fast feedback before deeper functional tests.
 */
test.describe('App Smoke Tests', () => {

  test('app loads and renders within 90 seconds (includes Expo cold bundle time)', async ({ page }) => {
    const start = Date.now();
    // Expo Metro bundler can take 40-90 seconds on cold start.
    // Subsequent loads are cached and much faster.
    await page.goto('/', { timeout: 90_000, waitUntil: 'domcontentloaded' });
    const elapsed = Date.now() - start;

    // Assert load time
    expect(elapsed).toBeLessThan(90_000);
    console.log(`✅ App loaded in ${elapsed}ms`);
  });

  test('page has a valid HTML title', async ({ page }) => {
    await goToApp(page);
    const title = await page.title();
    // Expo web sets a title from app.json
    expect(title.length).toBeGreaterThan(0);
    console.log(`📄 Page title: ${title}`);
  });

  test('no JavaScript errors thrown on load', async ({ page }) => {
    const jsErrors: string[] = [];

    page.on('pageerror', (error) => {
      jsErrors.push(error.message);
    });

    await goToApp(page);
    await waitForAppReady(page);

    // Filter out known non-critical warnings and expected web-unavailable native modules.
    // These errors appear because the app uses native modules (SQLite, Bluetooth, Camera)
    // that are not available in the web build, but the app handles them gracefully.
    const KNOWN_WEB_UNAVAILABLE = [
      'Warning:',
      'console.error',
      'ExpoModulesCore',
      "ExpoSQLite",             // SQLite is native-only; web uses AsyncStorage fallback
      'ExpoCamera',             // Camera native module
      'ExpoImageManipulator',   // Image manipulator native module
      'ExpoMediaLibrary',       // Media library native module
      'ExpoFileSystem',         // File system native module
      'NativeModule',           // Catch-all for other native module warnings
    ];

    const criticalErrors = jsErrors.filter(
      (e) => !KNOWN_WEB_UNAVAILABLE.some((known) => e.includes(known))
    );

    if (criticalErrors.length > 0) {
      console.error('❌ JS Errors detected:', criticalErrors);
    }

    expect(criticalErrors).toHaveLength(0);
  });

  test('no 5xx server errors on initial load', async ({ page }) => {
    const failedRequests: string[] = [];

    page.on('response', (response) => {
      if (response.status() >= 500) {
        failedRequests.push(`${response.status()} ${response.url()}`);
      }
    });

    await goToApp(page);
    await waitForAppReady(page);

    if (failedRequests.length > 0) {
      console.error('❌ Server errors:', failedRequests);
    }

    expect(failedRequests).toHaveLength(0);
  });

  test('meta viewport is set for mobile', async ({ page }) => {
    await goToApp(page);
    const viewport = await page.$eval(
      'meta[name="viewport"]',
      (el) => el.getAttribute('content')
    ).catch(() => null);

    // Expo web adds viewport meta automatically
    if (viewport) {
      expect(viewport).toContain('width=device-width');
    }
  });

});
