import { test, expect } from '@playwright/test';
import { loginAsAuthenticatedUser } from '../utils/helpers';

test.describe('Advanced user journeys', () => {
  test.setTimeout(180_000);

  test.beforeEach(async ({ page }) => {
    test.skip(
      !process.env.TEST_DRIVER_CODE || process.env.TEST_DRIVER_CODE === 'TEST_DRIVER_CODE_NOT_SET',
      'Skipped: TEST_DRIVER_CODE not set. See docs/PLAYWRIGHT_TESTING.md'
    );
    await loginAsAuthenticatedUser(page);
  });

  test('user reaches the dashboard after login', async ({ page }) => {
    await expect(page.getByText('Home', { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: /^Orders$/i })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: /^Delivered$/i })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: /^Menu$/i })).toBeVisible({ timeout: 20_000 });
  });
});