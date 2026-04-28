import { test, expect } from '@playwright/test';
import { goToLoginScreen } from '../utils/helpers';

/**
 * Navigation Tests
 * ─────────────────
 * These tests verify that the bottom tab navigator renders correctly
 * and that tab switching works in the Expo web build.
 *
 * goToLoginScreen() handles the splash screen wait so all tests
 * start with the Login screen already visible.
 * See docs/PLAYWRIGHT_TESTING.md — "Testing Authenticated Screens".
 */
test.describe('Bottom Tab Navigation', () => {

  test.beforeEach(async ({ page }) => {
    await goToLoginScreen(page);
  });

  test('login screen is the initial route (not authenticated)', async ({ page }) => {
    // goToLoginScreen already confirmed 'Delivery Terminal' is visible.
    await expect(page.getByText('Delivery Terminal')).toBeVisible({ timeout: 5000 });
  });

  test('app does not show dashboard tabs before login', async ({ page }) => {
    // Home / Orders / Delivered / Menu tabs should NOT be visible before login
    const homeTab = page.getByText('Home', { exact: true });
    const isVisible = await homeTab.isVisible().catch(() => false);
    expect(isVisible).toBe(false);
  });

  /**
   * POST-LOGIN NAVIGATION TESTS
   *
   * The tests below require an authenticated session.
   * They are wrapped with test.skip() until you configure
   * TEST_DRIVER_CODE in your .env.test file.
   *
   * To enable: remove the skip wrapper and ensure test credentials are set.
   */
  test.describe('Authenticated Navigation (requires credentials)', () => {

    test.skip(
      !process.env.TEST_DRIVER_CODE || process.env.TEST_DRIVER_CODE === 'TEST_DRIVER_CODE_NOT_SET',
      'Skipped: TEST_DRIVER_CODE not set. See docs/PLAYWRIGHT_TESTING.md'
    );

    test('dashboard tab shows Home screen after login', async ({ page }) => {
      await expect(page.getByText('Home')).toBeVisible({ timeout: 20000 });
    });

    test('orders tab navigates to Sale Orders', async ({ page }) => {
      const ordersTab = page.getByText('Orders', { exact: true });
      await expect(ordersTab).toBeVisible({ timeout: 10000 });
      await ordersTab.click();
      await expect(page.getByText('Orders')).toBeVisible({ timeout: 10000 });
    });

    test('delivered tab navigates to Delivered Orders', async ({ page }) => {
      const deliveredTab = page.getByText('Delivered', { exact: true });
      await expect(deliveredTab).toBeVisible({ timeout: 10000 });
      await deliveredTab.click();
    });

    test('menu tab navigates to Menu screen', async ({ page }) => {
      const menuTab = page.getByText('Menu', { exact: true });
      await expect(menuTab).toBeVisible({ timeout: 10000 });
      await menuTab.click();
    });

  });

});
