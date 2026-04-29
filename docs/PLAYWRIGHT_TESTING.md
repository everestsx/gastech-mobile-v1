# Playwright Testing Guide — GasTech Mobile

> **Audience**: All developers on the GasTech Mobile project.  
> **Last updated**: April 2026  
> **Branch this applies to**: `qa` (QA Gate), runnable locally on any branch.

---

## Table of Contents

1. [Overview — Why Playwright?](#1-overview--why-playwright)
2. [How It Fits Into Our Branch Strategy](#2-how-it-fits-into-our-branch-strategy)
3. [How Playwright Works with an Expo App](#3-how-playwright-works-with-an-expo-app)
4. [Project Structure](#4-project-structure)
5. [First-Time Setup](#5-first-time-setup)
6. [Running Tests Locally](#6-running-tests-locally)
7. [Writing New Tests](#7-writing-new-tests)
8. [Environment Variables & Credentials](#8-environment-variables--credentials)
9. [The QA Branch CI Pipeline](#9-the-qa-branch-ci-pipeline)
10. [Reading Test Reports](#10-reading-test-reports)
11. [Test Categories Reference](#11-test-categories-reference)
12. [Troubleshooting](#12-troubleshooting)
13. [FAQ](#13-faq)

---

## 1. Overview — Why Playwright?

We previously relied on **manual testing on physical Android devices** before merging to production. This works but has problems:

| Problem | Impact |
|---|---|
| Manual testing is slow | Release cycles take longer |
| Tests depend on who is available | Inconsistent coverage |
| Easy to miss edge cases | Bugs reach production |
| No audit trail | Cannot prove what was tested |

**Playwright** solves this by automating the testing process:

- ✅ Runs automatically on every push to the `qa` branch
- ✅ Tests are repeatable and consistent — same tests, every time
- ✅ Produces a full HTML report with screenshots and traces on failure
- ✅ Blocks a merge to `production` if tests fail (CI gate)
- ✅ Can test both the **app UI** and the **backend API**

> **Manual device testing is still valuable** for final sign-off. Playwright is the automated safety net that runs before you pick up the device.

---

## 2. How It Fits Into Our Branch Strategy

### Branch Flow

```
┌─────────────┐     merge      ┌─────────────┐     merge     ┌────────────┐
│  feature/*  │ ─────────────► │ development │ ────────────► │     qa     │
│  (dev work) │                │ (integration│               │ (QA gate)  │
└─────────────┘                │   branch)   │               └─────┬──────┘
                               └─────────────┘                     │
                                                        Playwright runs here
                                                        (CI blocks merge if fail)
                                                                    │
                                                                    ▼
                                                            ┌────────────┐
                                                            │ production │
                                                            │ (live app) │
                                                            └────────────┘
```

### Rules

| Branch | Who Merges Into It | Tests That Run |
|---|---|---|
| `feature/*` | Feature developer | None (run locally) |
| `development` | Team lead after feature review | None (optional) |
| `qa` | Team lead from `development` | ✅ **Playwright full suite (CI)** |
| `production` | Only after QA passes | Smoke check post-deploy |

### The QA Gate Rule

> **You cannot merge `qa` → `production` if Playwright tests are failing.**

GitHub enforces this via **branch protection rules** (see [Setup CI Gate](#92-set-up-branch-protection-rule-on-github)).

---

## 3. How Playwright Works with an Expo App

GasTech Mobile is a **React Native** app. Playwright is a **browser automation** tool — it cannot control a native Android/iOS app directly.

We solve this using **Expo's web target**:

```
npx expo start --web
```

This compiles the app to run in a browser. Playwright then automates that browser version — clicking buttons, filling inputs, navigating screens — exactly as a user would, but automatically.

### What the Web Build Can Test

| Feature | Testable in Web? | Notes |
|---|---|---|
| Login screen | ✅ Yes | Vehicle dropdown, driver code, validation |
| Dashboard | ✅ Yes | Cards, stats, sync indicator |
| Orders list | ✅ Yes | List rendering, navigation |
| Order details | ✅ Yes | Form fields, actions |
| Payment flow | ✅ Yes | Button states, confirmations |
| Bluetooth printing | ⚠️ Partial | Native BT not available in browser, UI still testable |
| Camera / QR scan | ⚠️ Partial | Camera API limited in web; UI renders |
| Backend API calls | ✅ Yes | Playwright can make HTTP requests directly |

### What Requires Physical Device

These still need manual testing on device:
- Bluetooth printer actual connection + printing
- Camera live preview
- App update (expo-updates) install flow
- Push notifications
- Offline SQLite database under real network conditions

---

## 4. Project Structure

```
gastech-mobile-v1/
├── playwright.config.ts          ← Main Playwright configuration
├── .env.test.example             ← Template for test credentials (copy to .env.test)
├── .github/
│   └── workflows/
│       └── qa-playwright.yml     ← GitHub Actions CI workflow
└── tests/
    ├── smoke/
    │   └── app.spec.ts           ← App loads, no JS errors, no server errors
    ├── auth/
    │   └── login.spec.ts         ← Login screen UI and validation
    ├── navigation/
    │   └── tabs.spec.ts          ← Bottom tab navigation
    ├── api/
    │   └── api-health.spec.ts    ← Backend API health checks
    └── utils/
        └── helpers.ts            ← Shared helpers used by all test files
```

### Adding New Tests

Create a new `.spec.ts` file inside the appropriate `tests/` subfolder:

```
tests/
├── orders/
│   └── order-list.spec.ts    ← Your new test file
├── payments/
│   └── payment-flow.spec.ts
```

Playwright automatically discovers all `*.spec.ts` files.

---

## 5. First-Time Setup

### Step 1: Install Dependencies

```bash
npm install
```

This installs `@playwright/test` which was added to `devDependencies`.

### Step 2: Install Playwright Browsers

```bash
npx playwright install --with-deps chromium firefox
```

This downloads Chromium and Firefox browser binaries. Only needed once per machine.

### Step 3: Set Up Test Credentials

```bash
# Copy the template
cp .env.test.example .env.test
```

Open `.env.test` and fill in your values:

```env
PLAYWRIGHT_BASE_URL=http://localhost:8081
API_BASE_URL=https://your-odoo-server.com
TEST_DRIVER_CODE=your_qa_driver_barcode
```

> ⚠️ **Never commit `.env.test`**. It is in `.gitignore`. Use a dedicated QA test account — not a real driver's code.

### Step 4: Verify Setup

```bash
npm run test:smoke
```

You should see tests run and (most likely) pass with the smoke checks.

---

## 6. Running Tests Locally

### Run All Tests

```bash
npm test
# or
npx playwright test
```

Playwright will automatically start the Expo web server, run all tests, then stop the server.

### Run Specific Test Suites

```bash
# Smoke tests only (fastest — run first)
npm run test:smoke

# Login / auth tests
npm run test:auth

# API tests (requires API_BASE_URL in .env.test)
npm run test:api

# Specific file
npx playwright test tests/navigation/tabs.spec.ts

# Tests matching a keyword
npx playwright test --grep "Login Screen"
```

### Run in Headed Mode (See the Browser)

```bash
npm run test:headed
# or
npx playwright test --headed
```

This opens a real browser window so you can watch the tests run — useful for debugging.

### Run with the Interactive UI

```bash
npm run test:ui
# or
npx playwright test --ui
```

This opens the Playwright UI app — you can see tests, run them individually, inspect traces, and replay failures step-by-step.

### Run on a Specific Browser

```bash
npx playwright test --project=chromium
npx playwright test --project=firefox
npx playwright test --project=mobile-chrome
```

### View the Last Test Report

```bash
npm run test:report
# or
npx playwright show-report
```

---

## 7. Writing New Tests

### Basic Test File Structure

```typescript
import { test, expect } from '@playwright/test';
import { goToApp, waitForText } from '../utils/helpers';

test.describe('My Feature Name', () => {

  // Runs before each test in this group
  test.beforeEach(async ({ page }) => {
    await goToApp(page);
  });

  test('should do something specific', async ({ page }) => {
    // 1. Arrange — set up state
    await waitForText(page, 'Some Text');

    // 2. Act — interact with the app
    await page.getByText('Click Me').click();

    // 3. Assert — verify the outcome
    await expect(page.getByText('Result Text')).toBeVisible();
  });

});
```

### Writing Higher-Level Scripts

For most feature work, write tests around a **user journey** instead of a single button click. A higher-level script should read like a business flow:

- login as a real QA user
- open the target screen
- perform the action the user cares about
- assert the end result, not every intermediate click

Keep the low-level Playwright calls inside small reusable helpers, then compose those helpers into tests.

```typescript
// tests/utils/helpers.ts
export async function loginAsQaDriver(page) {
  await page.goto('/');
  await page.getByTestId('driver-code-input').fill(process.env.TEST_DRIVER_CODE ?? '');
  await page.getByTestId('login-submit-btn').click();
}

export async function openOrderCancellation(page, orderNumber) {
  await page.getByTestId(`order-card-${orderNumber}`).click();
  await page.getByTestId('cancel-order-btn').click();
}

// tests/orders/cancel-order.spec.ts
test('driver can cancel an order from the list', async ({ page }) => {
  await loginAsQaDriver(page);
  await openOrderCancellation(page, 'SO12345');

  await expect(page.getByText('Cancel this order?')).toBeVisible();
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByText('Order cancelled')).toBeVisible();
});
```

Use this style when:

- several screens are involved
- the same flow will be reused by multiple tests
- the test should describe the product behavior, not the UI mechanics

Keep a lower-level test only when you are checking a specific component behavior, selector, or edge-case interaction.

### Key Playwright APIs

```typescript
// Navigate
await page.goto('/');
await page.goto('http://localhost:8081');

// Find elements
page.getByText('Login')           // by visible text
page.getByRole('button')          // by ARIA role
page.getByTestId('login-btn')     // by testID prop
page.locator('input').first()     // by CSS selector

// Interact
await page.getByText('Login').click();
await page.locator('input').fill('my value');
await page.keyboard.press('Enter');

// Assert
await expect(page.getByText('Welcome')).toBeVisible();
await expect(page.getByText('Error')).not.toBeVisible();
await expect(page).toHaveURL('/dashboard');

// Wait
await page.waitForTimeout(1000);                    // wait ms (avoid if possible)
await page.waitForSelector('text=Loading...');      // wait for element
await expect(element).toBeVisible({ timeout: 10000 }); // wait up to 10s
```

### Using testID for Reliable Selectors

The most reliable way to select elements is via `testID`. Add it to your React Native components:

```jsx
// In your React Native component:
<TouchableOpacity testID="login-submit-btn" onPress={handleLogin}>
  <Text>Login</Text>
</TouchableOpacity>

// In your Playwright test:
await page.getByTestId('login-submit-btn').click();
```

> **Best practice**: Add `testID` props to all interactive elements (buttons, inputs, list items) as you develop features. This makes test selectors stable even when text changes.

### Skipping Tests That Need Authentication

Use `test.skip()` to gate tests that require real credentials:

```typescript
test.skip(
  !process.env.TEST_DRIVER_CODE,
  'Skipped: TEST_DRIVER_CODE not set. See docs/PLAYWRIGHT_TESTING.md'
);
```

### Handling Tests That Are Flaky (Timing Issues)

```typescript
// Add retries to a single test
test('flaky test', { retries: 2 }, async ({ page }) => {
  // ...
});

// Increase timeout for slow operations
test('slow test', async ({ page }) => {
  test.setTimeout(60_000); // 60 second timeout for this test only
  // ...
});
```

---

## 8. Environment Variables & Credentials

### Local Development

Create `.env.test` (not committed):

```env
PLAYWRIGHT_BASE_URL=http://localhost:8081
API_BASE_URL=https://your-odoo-server.com
TEST_DRIVER_CODE=QA_DRIVER_BARCODE
```

Load this file when running tests locally:

```bash
# Windows PowerShell
$env:TEST_DRIVER_CODE="your_code"; npx playwright test

# Or install dotenv-cli for easier loading
npx dotenv -e .env.test -- playwright test
```

### CI (GitHub Actions)

In CI, credentials are stored as **GitHub Secrets** — never in the code.

To add secrets:
1. Go to your GitHub repository
2. Click **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Add these secrets:

| Secret Name | Value |
|---|---|
| `API_BASE_URL` | Your Odoo server URL |
| `TEST_DRIVER_CODE` | QA test driver barcode |

The workflow file (`.github/workflows/qa-playwright.yml`) reads these automatically.

---

## 9. The QA Branch CI Pipeline

### 9.1 How It Triggers

The GitHub Actions workflow runs automatically when:
- A **push** is made directly to `qa`
- A **pull request** is opened/updated that targets `qa`

```yaml
on:
  push:
    branches: [qa]
  pull_request:
    branches: [qa]
```

### 9.2 Set Up Branch Protection Rule on GitHub

This makes Playwright a **required check** — the `qa → production` merge is blocked if tests fail.

1. Go to your GitHub repository
2. Click **Settings** → **Branches**
3. Click **Add rule** (or edit the `qa` branch rule)
4. Set **Branch name pattern**: `qa`
5. Enable: ✅ **Require status checks to pass before merging**
6. Search for and add: `Playwright Tests (QA Gate)`
7. Enable: ✅ **Require branches to be up to date before merging**
8. Click **Save changes**

Also protect the `production` branch:
1. Add a rule for `production`
2. Require the `qa` branch to be the source (via PR only)

### 9.3 What the Pipeline Does — Step by Step

```
┌─ GitHub Actions: qa-playwright.yml ─────────────────────────────────┐
│                                                                       │
│  1. Checkout code from qa branch                                      │
│  2. Set up Node.js 20                                                 │
│  3. Install npm dependencies (npm ci)                                 │
│  4. Install Playwright browsers (Chromium + Firefox)                  │
│  5. Create output directories (test-results/, playwright-report/)     │
│  6. Start Expo web server in background (via playwright.config.ts)    │
│  7. Run all Playwright tests                                          │
│  8. Upload HTML report as a downloadable artifact                     │
│  9. Upload screenshots/traces as artifacts                            │
│  10. If tests failed → fail the CI job (blocks merge)                │
│  11. Post test summary to the job log                                 │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘
```

### 9.4 Viewing CI Results

1. Go to the GitHub repository
2. Click the **Actions** tab
3. Click the latest **Playwright QA Tests** run
4. In the **Summary** section, you'll see a pass/fail table
5. Under **Artifacts**, download `playwright-report-<run-number>` and open `index.html`

---

## 10. Reading Test Reports

### Local HTML Report

After running tests:
```bash
npm run test:report
```

This opens a browser with the full report showing:
- ✅ / ❌ status for each test
- Duration per test
- Screenshots on failure
- Step-by-step trace on failure (click "Trace" on any failed test)

### CI Artifact Report

Download `playwright-report-<run-number>.zip` from the GitHub Actions artifacts, unzip it, and open `index.html` in your browser.

### Understanding the Trace Viewer

When a test fails, Playwright records a trace. Click **Trace** on any failed test to open the Trace Viewer, which shows:
- Every action taken (click, fill, navigate)
- A DOM snapshot at each step
- Network requests made
- Console logs

This makes it easy to see exactly where and why a test failed.

---

## 11. Test Categories Reference

### Smoke Tests (`tests/smoke/`)

**Purpose**: Fast health checks. Confirm the app loads at all.  
**When to run**: Always run first. If smoke fails, other tests won't be meaningful.  
**Requires credentials**: No

| Test | What It Checks |
|---|---|
| App loads within 30 seconds | Performance baseline |
| Page has a valid HTML title | Expo build produced a page |
| No JavaScript errors on load | React Native Web mounted without errors |
| No 5xx server errors | Expo dev server is healthy |

### Auth Tests (`tests/auth/`)

**Purpose**: Verify the login screen renders and validates input correctly.  
**Requires credentials**: No (UI checks only)

| Test | What It Checks |
|---|---|
| App loads without crashing | Basic render |
| "Delivery Terminal" title visible | Screen title present |
| Vehicle dropdown visible | "Select Vehicle" placeholder |
| Driver code input visible | Form field rendered |
| Login button visible | Action button present |
| Alert on empty submit | Validation working |

### Navigation Tests (`tests/navigation/`)

**Purpose**: Verify tab navigation renders correctly.  
**Requires credentials**: No for pre-login checks; Yes for post-login tab switching.

### API Tests (`tests/api/`)

**Purpose**: Verify the Odoo backend is healthy and responding correctly.  
**Requires credentials**: Partially (some tests skip without `API_BASE_URL`)

| Test | What It Checks |
|---|---|
| API server reachable | Connectivity |
| Session endpoint responds | Auth layer is up |
| Response time < 5 seconds | Performance |
| JSON content-type returned | API contract |

---

## 12. Troubleshooting

### ❌ "Expo web server did not start in time"

The Playwright config waits 2 minutes for the Expo bundler. If it times out:

```bash
# Start the server manually first
npx expo start --web --port 8081

# Then in another terminal, run tests without the webServer config
PLAYWRIGHT_BASE_URL=http://localhost:8081 npx playwright test
```

Or increase the timeout in `playwright.config.ts`:
```typescript
webServer: {
  timeout: 180_000,  // 3 minutes
}
```

### ❌ Tests fail with "element not found"

The app may still be loading. Increase the timeout or wait for a specific element:

```typescript
// Instead of:
await page.getByText('Login').click();

// Use:
await expect(page.getByText('Login')).toBeVisible({ timeout: 20000 });
await page.getByText('Login').click();
```

### ❌ "Cannot find module @playwright/test"

Run:
```bash
npm install
npx playwright install
```

### ❌ Tests pass locally but fail in CI

Common causes:
1. **Environment variables not set** → Add secrets to GitHub Actions (see §8)
2. **Different timing in CI** → Increase timeouts in `playwright.config.ts`
3. **Expo bundling slower in CI** → Increase `webServer.timeout`

### ❌ "PLAYWRIGHT_BASE_URL not set" warning

Copy the example env file:
```bash
cp .env.test.example .env.test
```
Then fill in your values.

### ❌ Bluetooth / Camera tests fail in web

Expected. Those native features are not available in the browser. Tests for those screens should test the **UI only** (buttons visible, navigation works) — not the actual hardware functionality.

---

## 13. FAQ

**Q: Do I need to write tests for every feature I develop?**  
A: For any feature that goes to `production`, yes — at minimum a smoke test and a rendering check. Complex flows (payment, order delivery) should have detailed step tests.

**Q: Can I skip the QA tests to merge faster?**  
A: No. The branch protection rule prevents merging `qa` → `production` if tests fail. Talk to the team lead if there's an urgent hotfix — the rule can be temporarily bypassed with admin access, but this should be rare and documented.

**Q: What if the tests are wrong (false negatives)?**  
A: Fix the test, not the product. If a test is incorrectly failing due to a timing issue or bad selector, fix the test in a PR and merge it. Do not just skip it.

**Q: How do I test things that require a real Odoo login?**  
A: Add `TEST_DRIVER_CODE` to your `.env.test` and ensure the gated tests (`test.skip(!)`) are enabled. Use a dedicated QA account in your Odoo instance — never use a real driver's credentials in automated tests.

**Q: Who maintains the test suite?**  
A: Every developer who adds a feature is responsible for adding tests for that feature. Tests live alongside the code in the same repository.

**Q: What about iOS testing?**  
A: Playwright tests the web build, which covers both iOS and Android logic. For iOS-specific native features (camera, notifications), manual device testing is still required.

---

## Quick Reference — Commands

| Command | What It Does |
|---|---|
| `npm test` | Run all Playwright tests |
| `npm run test:headed` | Run with visible browser |
| `npm run test:ui` | Open interactive Playwright UI |
| `npm run test:smoke` | Run smoke tests only (fastest) |
| `npm run test:auth` | Run auth/login tests |
| `npm run test:api` | Run API health tests |
| `npm run test:report` | Open last HTML report |
| `npx playwright test --grep "keyword"` | Run tests matching keyword |
| `npx playwright test --project=mobile-chrome` | Run on mobile viewport |
| `npx playwright install` | (Re)install browsers |

---

*This document is maintained in `docs/PLAYWRIGHT_TESTING.md`. Update it whenever the testing process changes.*
