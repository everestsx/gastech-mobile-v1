import { Page, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// Environment helpers
// ---------------------------------------------------------------------------
export const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:8081';

/** Test credentials from env vars — never hard-code real creds in source. */
export const TEST_CREDENTIALS = {
  driverCode: process.env.TEST_DRIVER_CODE || 'TEST_DRIVER_CODE_NOT_SET',
};

// ---------------------------------------------------------------------------
// Wait helpers
// ---------------------------------------------------------------------------

/**
 * Wait for the Expo web app to finish its initial hydration/splash.
 * Adjust the selector if your splash screen renders a unique element.
 */
export async function waitForAppReady(page: Page): Promise<void> {
  // Wait until the body has loaded and React has rendered something
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500); // Allow React Native Web to mount
}

/**
 * Wait for a specific text to appear anywhere on the page.
 */
export async function waitForText(page: Page, text: string, timeoutMs = 15000) {
  await expect(page.getByText(text)).toBeVisible({ timeout: timeoutMs });
}

// ---------------------------------------------------------------------------
// Navigation helpers
// ---------------------------------------------------------------------------

/**
 * Navigate to the app root and wait for it to be ready.
 */
export async function goToApp(page: Page): Promise<void> {
  await page.goto('/');
  await waitForAppReady(page);
}

/**
 * Navigate to the app and wait for the Login screen to become visible.
 *
 * WHY: The SplashScreen calls SQLite.openDatabaseAsync() which is a native
 * module that NEVER resolves its Promise in the web environment. This means
 * navigation.replace('Login') is never called from the splash's useEffect.
 *
 * WORKAROUND: We use waitForFunction() to poll document.body.innerText
 * (raw DOM text, more reliable than getByText for React Native Web). If
 * 'Delivery Terminal' doesn't appear within 90s, we throw a clear error.
 *
 * The test timeout must be >= 90s for tests using this helper.
 * Set `test.setTimeout(120_000)` in any describe block that calls this.
 */
export async function goToLoginScreen(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 90_000 });

  // Poll raw DOM text — reliable even when React Native Web uses custom Text components.
  await page.waitForFunction(
    () => document.body.innerText.includes('Delivery Terminal'),
    null,
    { timeout: 90_000, polling: 1500 }
  );
}

// ---------------------------------------------------------------------------
// Login helpers
// ---------------------------------------------------------------------------

/**
 * Attempt to fill in a driver code and press the login/proceed button.
 * Returns false if the login UI is not visible (e.g., already logged in).
 *
 * NOTE: GasTech login requires:
 *  1. A vehicle selected from dropdown
 *  2. A driver barcode/code entered
 *  3. Driver face confirmed (driverReview phase)
 *  4. Porters selected (porterPick phase)
 *
 * In web-testing mode we rely on the UI being rendered in the browser.
 */
export async function fillDriverCode(page: Page, code: string): Promise<void> {
  // The driver code input — React Native Web renders TextInput as <input>
  const input = page.locator('input[placeholder*="driver" i], input[placeholder*="code" i], input[type="password"]').first();
  await input.fill(code);
}

/**
 * Click the primary action button (Login / Proceed / Confirm).
 */
export async function clickPrimaryButton(page: Page, label?: string): Promise<void> {
  if (label) {
    await page.getByRole('button', { name: label }).click();
  } else {
    // Fallback: click the first prominent button
    await page.locator('button').first().click();
  }
}

function matchesText(text: string, matcher: string | RegExp): boolean {
  return typeof matcher === 'string' ? text === matcher : matcher.test(text);
}

/**
 * Click the first visible button whose text matches the include/exclude rules.
 * This is useful for React Native Web screens where some actions are rendered
 * as TouchableOpacity buttons without stable testIDs yet.
 */
export async function clickFirstVisibleButton(
  page: Page,
  options: {
    include?: string | RegExp;
    exclude?: Array<string | RegExp>;
    timeoutMs?: number;
  } = {}
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const buttons = page.getByRole('button');
    const count = await buttons.count();

    for (let index = 0; index < count; index += 1) {
      const button = buttons.nth(index);
      const isVisible = await button.isVisible().catch(() => false);
      if (!isVisible) continue;

      const rawText = await button.innerText().catch(() => '');
      const text = rawText.replace(/\s+/g, ' ').trim();
      if (!text) continue;

      if (options.include && !matchesText(text, options.include)) continue;
      if (options.exclude?.some((matcher) => matchesText(text, matcher))) continue;

      await button.click();
      return text;
    }

    await page.waitForTimeout(250);
  }

  throw new Error('Could not find a matching visible button to click.');
}

/**
 * Complete the login flow and land on the dashboard using the QA driver code.
 *
 * This uses only visible labels/buttons, so it stays close to the actual user
 * journey instead of bypassing the app state.
 */
export async function loginAsAuthenticatedUser(page: Page): Promise<void> {
  if (!TEST_CREDENTIALS.driverCode || TEST_CREDENTIALS.driverCode === 'TEST_DRIVER_CODE_NOT_SET') {
    throw new Error('TEST_DRIVER_CODE is required for loginAsAuthenticatedUser');
  }

  await goToLoginScreen(page);
  await expect(page.getByText('Delivery Terminal')).toBeVisible({ timeout: 15_000 });

  await page.getByText('Select Vehicle').click();
  await clickFirstVisibleButton(page, {
    exclude: [/^Select Vehicle$/i, /^Login$/i, /^English$/i, /^தமிழ்$/i, /^සිංහල$/i],
    timeoutMs: 10_000,
  });

  const input = page.locator('input[placeholder*="driver" i], input[placeholder*="pin" i], input[type="password"]').first();
  await input.fill(TEST_CREDENTIALS.driverCode);

  await page.getByRole('button', { name: /^Login$/i }).click();
  await expect(page.getByText(/Signed in as driver/i)).toBeVisible({ timeout: 20_000 });

  await page.getByRole('button', { name: /^Continue$/i }).click();
  await expect(page.getByText(/Who's on this shift\?/i)).toBeVisible({ timeout: 20_000 });

  await clickFirstVisibleButton(page, {
    exclude: [/^Back$/i, /^Go to dashboard$/i],
    timeoutMs: 15_000,
  });

  await page.getByRole('button', { name: /^Go to dashboard$/i }).click();
  await expect(page.getByText('Home')).toBeVisible({ timeout: 20_000 });
}

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

/**
 * Assert that the current page contains a visible heading or title text.
 */
export async function assertPageTitle(page: Page, title: string): Promise<void> {
  await expect(page.getByText(title, { exact: false })).toBeVisible({ timeout: 10000 });
}

/**
 * Assert that an element with a given testID is visible.
 * Use testID="..." on React Native components to expose them in web tests.
 */
export async function assertTestId(page: Page, testId: string): Promise<void> {
  await expect(page.getByTestId(testId)).toBeVisible({ timeout: 10000 });
}

// ---------------------------------------------------------------------------
// Screenshot helpers
// ---------------------------------------------------------------------------

/**
 * Take a full-page screenshot and save to test-results/.
 */
export async function takeScreenshot(page: Page, name: string): Promise<void> {
  await page.screenshot({
    path: `test-results/screenshots/${name}.png`,
    fullPage: true,
  });
}
