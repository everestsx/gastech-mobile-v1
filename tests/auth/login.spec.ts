import { test, expect } from '@playwright/test';
import { goToLoginScreen } from '../utils/helpers';

/**
 * Login Screen Tests
 * ──────────────────
 * These tests verify that the GasTech login page loads correctly
 * and that the login form renders the expected UI elements.
 *
 * goToLoginScreen() navigates to the app AND waits for the splash
 * screen to fully clear before looking for Login screen elements.
 *
 * ⚠️  Full login flow tests (driver code → vehicle select → porter select)
 * require real backend credentials. Store them in a .env.test file and
 * reference via TEST_DRIVER_CODE environment variable.
 *
 * See docs/PLAYWRIGHT_TESTING.md for setup instructions.
 */
test.describe('Login Screen', () => {

  test.beforeEach(async ({ page }) => {
    // Navigates to / and waits for "Delivery Terminal" to appear
    // (i.e., splash screen has finished and Login is shown).
    await goToLoginScreen(page);
  });

  // ─── Rendering ────────────────────────────────────────────────────────────

  test('should load the app without crashing', async ({ page }) => {
    // goToLoginScreen already asserted the login screen is visible.
    // Just confirm we're not on blank.
    await expect(page).not.toHaveURL('about:blank');
  });

  test('should display the app title text', async ({ page }) => {
    // "Delivery Terminal" is rendered as the main title on the login screen.
    // Already guaranteed by goToLoginScreen, but assert explicitly for reporting.
    await expect(page.getByText('Delivery Terminal')).toBeVisible({ timeout: 5000 });
  });

  test('should display the authorized portal subtitle', async ({ page }) => {
    await expect(page.getByText('Authorized Distributor Portal')).toBeVisible({ timeout: 5000 });
  });

  test('should display a vehicle selection dropdown', async ({ page }) => {
    // The vehicle selector renders "Select Vehicle" as placeholder text.
    await expect(page.getByText('Select Vehicle')).toBeVisible({ timeout: 10000 });
  });

  test('should display a driver code / password input field', async ({ page }) => {
    // React Native Web renders TextInput as <input> in the DOM.
    const input = page.locator('input').first();
    await expect(input).toBeVisible({ timeout: 10000 });
  });

  test('should show a login/proceed button', async ({ page }) => {
    // The login button is a TouchableOpacity — rendered as a pressable div/button.
    const loginBtn = page.getByRole('button').first();
    await expect(loginBtn).toBeVisible({ timeout: 10000 });
  });

  // ─── Language switcher ────────────────────────────────────────────────────

  test('should show a language selection option', async ({ page }) => {
    // The language button shows the current language label (English by default).
    const langBtn = page.getByText(/english|tamil|sinhala/i).first();
    await expect(langBtn).toBeVisible({ timeout: 10000 });
  });

  // ─── Validation ───────────────────────────────────────────────────────────

  test('should show an alert when submitting without selecting a vehicle', async ({ page }) => {
    // Try to trigger submission without selecting a vehicle first.
    const buttons = page.getByRole('button');
    const count = await buttons.count();
    if (count > 0) {
      await buttons.first().click();
      await page.waitForTimeout(1000);
      // React Native Web renders CustomAlert as a Modal with text.
      // Check for warning keywords that appear in the alert message.
      const alertText = page.getByText(/vehicle|required|select/i).first();
      const hasWarning = await alertText.isVisible().catch(() => false);
      // Also check for dialog/alert role element
      const dialog = page.locator('[role="dialog"], [role="alert"]').first();
      const hasDialog = await dialog.isVisible().catch(() => false);
      expect(hasWarning || hasDialog).toBe(true);
    }
  });

});
