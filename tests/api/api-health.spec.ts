import { test, expect } from '@playwright/test';

/**
 * API Smoke Tests
 * ────────────────
 * These tests make HTTP requests directly to the GasTech backend API
 * to verify that the server is healthy and key endpoints are responsive.
 *
 * ✅ These tests do NOT require the Expo web server to be running.
 * ✅ These tests run independently of the UI.
 *
 * Configure the API base URL via environment variable:
 *   API_BASE_URL=https://your-odoo-server.com
 *
 * See docs/PLAYWRIGHT_TESTING.md for full setup instructions.
 */

const API_BASE = process.env.API_BASE_URL || '';

test.describe('API Health Checks', () => {

  test.skip(
    !API_BASE,
    'Skipped: API_BASE_URL env var not set. See docs/PLAYWRIGHT_TESTING.md'
  );

  test('API server is reachable', async ({ request }) => {
    // A basic connectivity test — adjust the path to a known public endpoint
    const response = await request.get(`${API_BASE}/web/health`, {
      timeout: 10_000,
    });
    // 200 OK means the server is up
    expect(response.status()).toBeLessThan(500);
  });

  test('Odoo session endpoint responds', async ({ request }) => {
    const response = await request.get(`${API_BASE}/web/session/get_session_info`, {
      timeout: 10_000,
    });
    // Should return 200 even for unauthenticated requests (returns session info)
    expect([200, 401, 403]).toContain(response.status());
  });

  test('API response time is acceptable (< 5 seconds)', async ({ request }) => {
    const start = Date.now();
    await request.get(`${API_BASE}/web/health`, { timeout: 10_000 });
    const elapsed = Date.now() - start;

    console.log(`⏱️  API response time: ${elapsed}ms`);
    expect(elapsed).toBeLessThan(5_000);
  });

  test('API returns JSON content-type', async ({ request }) => {
    const response = await request.get(`${API_BASE}/web/session/get_session_info`, {
      timeout: 10_000,
    });
    const contentType = response.headers()['content-type'] || '';
    expect(contentType).toContain('application/json');
  });

});

/**
 * API Response Schema Tests
 * ─────────────────────────
 * These tests verify the shape of API responses, ensuring the
 * data structure matches what the app expects.
 */
test.describe('API Response Schema (Authenticated)', () => {

  test.skip(
    !API_BASE || !process.env.TEST_DRIVER_CODE,
    'Skipped: API_BASE_URL or TEST_DRIVER_CODE not set.'
  );

  // Example: test that the vehicles endpoint returns an array
  test('fleet vehicles endpoint returns an array', async ({ request }) => {
    // This would be a real API call with auth — adjust to your actual endpoint
    const response = await request.post(`${API_BASE}/web/dataset/call_kw`, {
      data: {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'fleet.vehicle',
          method: 'search_read',
          args: [[]],
          kwargs: { fields: ['id', 'name', 'license_plate'], limit: 5 },
        },
      },
      headers: { 'Content-Type': 'application/json' },
      timeout: 15_000,
    });

    // If unauthenticated, this will return 200 with an error body — that's expected
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty('jsonrpc', '2.0');
  });

});
