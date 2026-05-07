# Appium Migration Plan — GasTech Mobile

Replace Playwright (browser-based E2E testing) with Appium (native mobile E2E testing) for the GasTech Mobile React Native/Expo app.

---

## Background & Motivation

The current Playwright setup tests the **Expo web build** (`expo start --web`) in a browser. While functional for basic UI checks and API health, it has critical limitations for a production mobile app:

| Limitation | Impact |
|---|---|
| Tests run against web build, not the real APK | Native modules (SQLite, Bluetooth, Camera) are unavailable — tests skip them |
| SplashScreen has a 5-second timeout hack for web | Tests never verify the real app startup flow |
| Cannot test actual touch gestures | No swipe, long-press, pinch, or scroll-momentum testing |
| Cannot test device-level features | No Bluetooth printing, camera QR scanning, push notifications |
| `react-native-web` rendering differs from native | UI bugs can exist on-device but pass in browser |

**Appium** tests against the **actual APK on a real device or emulator**, eliminating all of the above.

---

## User Review Required

> [!IMPORTANT]
> **This plan removes ALL Playwright files from the project.** The API health tests (direct HTTP calls to Odoo) will be reimplemented as standalone Appium-independent tests using a simple HTTP client, since they don't need a UI at all.

> [!IMPORTANT]
> **You need an Android emulator or physical device with USB debugging** to run Appium tests locally. Your existing `android/` directory and debug APK build process will be used.

> [!WARNING]
> **CI/CD change**: The current `qa-playwright.yml` GitHub Actions workflow will be replaced with an Appium workflow using `reactivecircus/android-emulator-runner`. This requires Ubuntu runners with KVM support (GitHub's default `ubuntu-latest` supports this). The CI workflow will be significantly slower (5–10 min vs 2–3 min for Playwright) due to emulator boot time.

---

## Resolved Questions (Auto-Detected)

All questions were answered by inspecting the local dev environment:

| Question | Answer | How Detected |
|---|---|---|
| **Q1: Android emulator?** | ✅ AVD **`Medium_Phone`** exists — Android 16 (API 36), x86_64, Google Play image | `emulator -list-avds` + AVD config.ini |
| **Q1b: SDK levels?** | compileSdk **36**, targetSdk **36**, minSdk **23** (Expo SDK 54 defaults) | Expo 54 + RN 0.81 documentation |
| **Q2: Physical or emulator?** | **Emulator** — no physical device connected (`adb devices` returned empty). `Medium_Phone` AVD is ready to use | `adb devices` |
| **Q3: In-repo or separate?** | **In-repo** under `e2e/` — this is a single-repo project with no monorepo structure, keeping tests alongside source is the right call | Project structure inspection |
| **Q4: Cloud device farm?** | **Not now** — defer to a future phase. GitHub Actions emulator + local AVD is sufficient for current scale. Can revisit if CI becomes flaky or test suite grows significantly | Cost/complexity assessment |

### Environment Snapshot (Your Machine)

| Component | Status | Value |
|---|---|---|
| `ANDROID_HOME` | ✅ Set | `D:\androidsdk` |
| `adb` | ✅ Working | Daemon starts successfully |
| Java | ✅ JDK 17 | OpenJDK Temurin 17.0.17 |
| Android emulator | ✅ Configured | `Medium_Phone` (API 36, x86_64, Google Play) |
| Appium | ❌ **Not installed** | Needs `npm install -g appium` |
| Appium Inspector | ❌ **Not installed** | Download from GitHub releases |
| Debug APK | ❌ **Not built** | No `android/app/build/outputs/apk/` directory exists — needs `gradlew assembleDebug` |
| `JAVA_HOME` | ⚠️ **Not set** | Java is in PATH but `$env:JAVA_HOME` is empty — UIAutomator2 needs this set |

---

## Phase 0: Remove Playwright (Cleanup)

### Files to DELETE

| File/Directory | Type | Purpose |
|---|---|---|
| `playwright.config.ts` | Config | Playwright configuration |
| `tests/` (entire directory) | Tests | All 6 Playwright test files + helpers |
| `playwright-report/` | Output | Generated HTML reports |
| `test-results/` | Output | Generated screenshots/JSON |
| `docs/PLAYWRIGHT_TESTING.md` | Docs | 706-line Playwright guide |
| `.env.test.example` | Config | Playwright-specific env template |
| `.github/workflows/qa-playwright.yml` | CI | GitHub Actions Playwright workflow |

### Files to MODIFY

#### [MODIFY] [package.json](file:///d:/EverestX/New%20folder/gastech-mobile-v1/package.json)
- **Remove** `@playwright/test` from `devDependencies`
- **Remove** all `test:*` scripts (`test`, `test:headed`, `test:ui`, `test:report`, `test:smoke`, `test:auth`, `test:api`)
- **Add** new Appium test scripts (see Phase 2)

#### [MODIFY] [.gitignore](file:///d:/EverestX/New%20folder/gastech-mobile-v1/.gitignore)
- **Remove** Playwright-specific ignores (`playwright-report/`, `test-results/`, `/tests/.auth/`, `.env.test`)
- **Add** Appium-specific ignores (see Phase 2)

#### [MODIFY] [metro.config.js](file:///d:/EverestX/New%20folder/gastech-mobile-v1/metro.config.js)
- The `.gradle` blockList workaround (lines 17–25) was added specifically for Playwright web testing. **Review whether to keep it** — it may still be useful for general Metro stability on Windows, so it's probably safe to keep.

#### [MODIFY] [SplashScreen.jsx](file:///d:/EverestX/New%20folder/gastech-mobile-v1/src/screens/SplashScreen.jsx)
- The `Promise.race` timeout hack (lines 56–68) was added for Playwright web compatibility. **Remove it** — Appium tests run on the real native app where SQLite works normally. Revert to a simple `await getDb()` call.

---

## Phase 1: Appium Environment Setup (Local Dev Machine)

### Prerequisites Checklist

| Requirement | Status | Details |
|---|---|---|
| Node.js 20+ | ✅ Ready | Already installed (project uses it) |
| Java JDK 17+ | ✅ Installed | Temurin 17.0.17 — **but `JAVA_HOME` must be set** |
| Android SDK | ✅ Ready | `ANDROID_HOME=D:\androidsdk` |
| `adb` in PATH | ✅ Working | Daemon starts, device listing works |
| Android emulator | ✅ Ready | `Medium_Phone` AVD (API 36, x86_64, Google Play) |
| Appium Server 2.x | ❌ **Install** | `npm install -g appium` |
| UIAutomator2 driver | ❌ **Install** | `appium driver install uiautomator2` |
| Appium Inspector | ❌ **Install** | Download `.exe` from GitHub releases |
| Debug APK | ❌ **Build** | Run `gradlew.bat assembleDebug` |

### Installation Steps (Windows PowerShell)

```powershell
# ── Step 1: Set JAVA_HOME (required — currently missing!) ──────────────
# Find your Java installation path:
Get-Command java | Select-Object -ExpandProperty Source
# Then set it permanently (adjust path if different):
[System.Environment]::SetEnvironmentVariable('JAVA_HOME', 'C:\Program Files\Eclipse Adoptium\jdk-17.0.17.10-hotspot', 'User')
# Restart your terminal after setting this!

# ── Step 2: Install Appium globally ────────────────────────────────────
npm install -g appium

# ── Step 3: Install UIAutomator2 driver ────────────────────────────────
appium driver install uiautomator2

# ── Step 4: Verify Appium environment ──────────────────────────────────
npm install -g @appium/doctor
appium-doctor --android
# Fix any ❌ items it reports before proceeding

# ── Step 5: Download Appium Inspector (GUI) ────────────────────────────
# → https://github.com/appium/appium-inspector/releases
# Download and install the Windows .exe
# This is your primary debugging & learning tool

# ── Step 6: Start the emulator ─────────────────────────────────────────
# Your existing AVD:
& "$env:ANDROID_HOME\emulator\emulator.exe" -avd Medium_Phone
# In a separate terminal, verify it's running:
adb devices
# Should show: emulator-5554   device
```

### Build the Debug APK

```powershell
# Build the staging debug APK (no APK exists yet — must build first)
cd "d:\EverestX\New folder\gastech-mobile-v1"
$env:APP_VARIANT="stage"

# Option A: Full Expo native build (includes prebuild + gradle)
npx expo run:android

# Option B: Gradle only (if android/ is already prebuilt)
cd android
.\gradlew.bat assembleDebug
# APK output: android\app\build\outputs\apk\debug\app-debug.apk
```

---

## Phase 2: Appium + WebDriverIO Project Setup

### New Directory Structure

```
gastech-mobile-v1/
├── e2e/                              ← NEW: All Appium tests live here
│   ├── wdio.conf.ts                  ← WebDriverIO + Appium configuration
│   ├── tsconfig.json                 ← TypeScript config for e2e tests
│   ├── helpers/
│   │   ├── testProps.ts              ← testID/accessibilityLabel helper
│   │   ├── gestures.ts              ← Touch gesture helpers (swipe, scroll)
│   │   └── wait.ts                  ← Smart wait utilities
│   ├── pageobjects/                 ← Page Object Model (one per screen)
│   │   ├── splash.page.ts
│   │   ├── login.page.ts
│   │   ├── dashboard.page.ts
│   │   ├── orders.page.ts
│   │   ├── order-detail.page.ts
│   │   ├── delivered.page.ts
│   │   └── menu.page.ts
│   ├── specs/                       ← Test files (mirror Playwright categories)
│   │   ├── smoke/
│   │   │   └── app-launch.spec.ts
│   │   ├── auth/
│   │   │   └── login.spec.ts
│   │   ├── navigation/
│   │   │   └── tabs.spec.ts
│   │   ├── journeys/
│   │   │   └── delivery-flow.spec.ts
│   │   └── api/
│   │       └── api-health.spec.ts   ← HTTP-only, no Appium needed
│   └── data/
│       └── test-credentials.ts      ← Env-based credentials loader
├── .env.test.example                 ← NEW: Appium-specific env template
```

### Package Dependencies to Add

```jsonc
// devDependencies
{
  "@wdio/cli": "^9.x",               // WebDriverIO CLI
  "@wdio/local-runner": "^9.x",      // Local test runner
  "@wdio/mocha-framework": "^9.x",   // Mocha test framework
  "@wdio/spec-reporter": "^9.x",     // Console reporter
  "@wdio/allure-reporter": "^9.x",   // Rich HTML reports (optional)
  "@wdio/appium-service": "^9.x",    // Auto-starts Appium server
  "ts-node": "^10.x",                // TypeScript support
  "webdriverio": "^9.x"              // Core WebDriverIO
}
```

### New npm Scripts in package.json

```jsonc
{
  "scripts": {
    // ... existing expo scripts unchanged ...
    "test:e2e": "wdio run e2e/wdio.conf.ts",
    "test:e2e:smoke": "wdio run e2e/wdio.conf.ts --spec e2e/specs/smoke/",
    "test:e2e:auth": "wdio run e2e/wdio.conf.ts --spec e2e/specs/auth/",
    "test:e2e:nav": "wdio run e2e/wdio.conf.ts --spec e2e/specs/navigation/",
    "test:e2e:api": "wdio run e2e/wdio.conf.ts --spec e2e/specs/api/",
    "test:e2e:journey": "wdio run e2e/wdio.conf.ts --spec e2e/specs/journeys/",
    "appium:start": "appium --relaxed-security",
    "appium:inspect": "npx start-appium-inspector"
  }
}
```

### .gitignore Additions

```gitignore
# Appium / WebDriverIO
e2e/allure-results/
e2e/allure-report/
.env.test

# Appium logs
appium-*.log
```

---

## Phase 3: WebDriverIO Configuration

### [NEW] `e2e/wdio.conf.ts`

Key configuration decisions:

```typescript
export const config: WebdriverIO.Config = {
  runner: 'local',
  port: 4723,
  specs: ['./e2e/specs/**/*.spec.ts'],
  maxInstances: 1,               // Single device — sequential tests
  
  capabilities: [{
    platformName: 'Android',
    'appium:automationName': 'UiAutomator2',
    'appium:deviceName': 'Medium_Phone',   // Your existing AVD
    'appium:avd': 'Medium_Phone',          // Auto-launch this AVD if not running
    'appium:platformVersion': '16',        // Android 16 (API 36) — matches your AVD
    'appium:app': './android/app/build/outputs/apk/debug/app-debug.apk',
    'appium:noReset': false,      // Fresh install each suite
    'appium:fullReset': false,    // Don't uninstall between tests
    'appium:newCommandTimeout': 120,
    'appium:autoGrantPermissions': true,  // Auto-grant camera, BT, location
  }],

  framework: 'mocha',
  mochaOpts: { timeout: 120_000 },
  
  services: [['appium', {
    args: { relaxedSecurity: true },
  }]],

  reporters: ['spec'],
  
  // Hooks
  beforeSession: () => { /* build APK if needed */ },
  afterTest: (test, context, result) => { /* screenshot on failure */ },
};
```

---

## Phase 4: Instrument Source Code with `testID` Props

### Current State

Your codebase has **zero `testID` props** and only a few `accessibilityLabel` props (5 files). Appium relies on these to locate elements.

### Strategy: `testProps()` Helper

Create a helper that sets both `testID` and `accessibilityLabel` for cross-platform compatibility:

```typescript
// e2e/helpers/testProps.ts (also importable in src/)
// OR better: src/utils/testProps.ts (so it's available in the app code)

import { Platform } from 'react-native';

export const testProps = (id: string) => ({
  testID: id,
  accessibilityLabel: id,
  ...(Platform.OS === 'android' ? { accessible: true } : {}),
});
```

### Screen-by-Screen Instrumentation Plan

> [!NOTE]
> The `testProps()` helper approach is additive — it does NOT change any existing behavior, styling, or functionality. It only adds metadata attributes that Appium can find. This is safe for the live production app.

Priority order (matches test implementation phases):

#### Tier 1 — Critical Path (Phase 5a)

| Screen | Key Elements to Instrument | Approx. Count |
|---|---|---|
| **SplashScreen** | spinner, logo, brand-text | 3 |
| **LoginScreen** | vehicle-dropdown, driver-code-input, login-button, language-switcher, alert-modal | 8–10 |
| **DashboardScreen** | home-tab, orders-tab, delivered-tab, menu-tab, sync-indicator, stat-cards | 10–15 |

#### Tier 2 — Core Business (Phase 5b)

| Screen | Key Elements to Instrument | Approx. Count |
|---|---|---|
| **SaleOrderListScreen** | order-cards, search-input, filter-buttons, refresh-button | 8–10 |
| **SaleOrderDetailsScreen** | order-header, customer-info, line-items, action-buttons | 12–15 |
| **ProceedPaymentScreen** | amount-fields, payment-method-selector, confirm-button | 8–10 |
| **DeliveredOrdersScreen** | delivered-list, order-cards, date-filter | 6–8 |

#### Tier 3 — Secondary Screens (Phase 5c)

| Screen | Key Elements to Instrument | Approx. Count |
|---|---|---|
| InvoiceScreen | invoice-details, print-button | 5–8 |
| MenuScreen | menu-items, logout-button, settings-link | 6–8 |
| VehicleStockScreen | stock-list, cylinder-counts | 5–7 |
| SettingsScreen | language-selector, theme-toggle | 4–6 |
| All remaining screens | Key interactive elements only | 3–5 each |

**Total: ~100–130 `testProps()` additions across 25 screens.**

---

## Phase 5: Test Implementation (Phased Rollout)

### Phase 5a — Smoke + Auth (Week 1)

Replaces Playwright's `tests/smoke/` and `tests/auth/`.

#### `e2e/specs/smoke/app-launch.spec.ts`
```
Tests to implement:
✅ App launches on device/emulator within 30 seconds
✅ Splash screen appears with GasTech branding
✅ Splash screen transitions to Login screen
✅ No crash on launch (app stays alive for 10 seconds)
```

#### `e2e/pageobjects/login.page.ts`
```
Page Object for Login screen — encapsulates:
- vehicle dropdown selector
- driver code input
- login button
- language switcher
- alert dialog
```

#### `e2e/specs/auth/login.spec.ts`
```
Tests to implement:
✅ Login screen displays all required elements
✅ Vehicle dropdown shows vehicle list
✅ Empty form submission shows validation alert
✅ Invalid driver code shows error
✅ Valid driver code + vehicle → proceeds to driver review
✅ Full login flow → dashboard
```

### Phase 5b — Navigation + Core Journeys (Week 2)

Replaces Playwright's `tests/navigation/` and `tests/advanced/`.

```
Tests to implement:
✅ Bottom tab navigation between Home, Orders, Delivered, Menu
✅ Order list loads and displays orders
✅ Tap order → navigates to order detail
✅ Order detail → Proceed Payment → back
✅ Delivered tab shows completed orders
✅ Menu tab shows settings and logout
```

### Phase 5c — Business Flows (Week 3+)

**NEW tests that Playwright COULD NOT do:**

```
Tests to implement:
✅ Full delivery flow: Login → Select Order → Deliver → Payment → Invoice
✅ Offline mode: disconnect network → app shows cached data
✅ Bluetooth printer connection (if on physical device)
✅ QR code scanning (camera permission flow)
✅ Language switching across screens
✅ App update check (expo-updates flow)
```

### Phase 5d — API Health (Standalone)

Reimplement the API health checks **without Appium** — they're pure HTTP calls:

```
Tests to implement:
✅ Odoo server is reachable
✅ Session endpoint responds
✅ Response time < 5 seconds
✅ JSON content-type returned
✅ Fleet vehicles endpoint returns valid schema
```

These can use a lightweight HTTP test runner (simple `fetch` + Node test runner, or a dedicated WDIO spec that uses `fetch` directly).

---

## Phase 6: CI/CD — GitHub Actions Workflow

### [NEW] `.github/workflows/qa-appium.yml`

Replace `qa-playwright.yml` with a new Appium workflow:

```yaml
name: Appium QA Tests

on:
  push:
    branches: [qa]
  pull_request:
    branches: [qa]

concurrency:
  group: appium-qa-${{ github.ref }}
  cancel-in-progress: true

jobs:
  appium-tests:
    name: Appium Tests (QA Gate)
    runs-on: ubuntu-latest
    timeout-minutes: 45

    env:
      APP_VARIANT: stage
      TEST_DRIVER_CODE: ${{ secrets.TEST_DRIVER_CODE }}
      API_BASE_URL: ${{ secrets.API_BASE_URL }}

    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm' }
      - uses: actions/setup-java@v4
        with: { java-version: '17', distribution: 'temurin' }

      - run: npm ci
      - run: npm install -g appium && appium driver install uiautomator2

      # Enable KVM for emulator acceleration
      - name: Enable KVM
        run: |
          echo 'KERNEL=="kvm", GROUP="kvm", MODE="0666"' | sudo tee /etc/udev/rules.d/99-kvm.rules
          sudo udevadm control --reload-rules && sudo udevadm trigger --name-match=kvm

      # Build the debug APK
      - name: Build Debug APK
        run: |
          cd android && chmod +x gradlew && ./gradlew assembleDebug

      # Boot emulator, start Appium, run tests
      - name: Run Appium Tests
        uses: reactivecircus/android-emulator-runner@v2
        with:
          api-level: 33
          target: google_apis
          arch: x86_64
          profile: Nexus 6
          script: |
            appium &
            sleep 10
            npm run test:e2e
        continue-on-error: true
        id: appium-run

      # Upload reports
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: appium-report-${{ github.run_number }}
          path: e2e/allure-results/
          retention-days: 30

      - name: Fail if tests failed
        if: steps.appium-run.outcome == 'failure'
        run: exit 1
```

---

## Phase 7: Documentation

### [NEW] `docs/APPIUM_TESTING.md`

Replace the 706-line `PLAYWRIGHT_TESTING.md` with an equivalent Appium guide covering:

1. Overview — Why Appium?
2. Prerequisites & Environment Setup
3. Project Structure
4. Running Tests Locally
5. Writing New Tests (Page Object Model)
6. The `testProps()` Instrumentation Pattern
7. Using Appium Inspector for Debugging
8. Environment Variables & Credentials
9. CI/CD Pipeline
10. Troubleshooting
11. Quick Reference Commands

---

## AI Prompt Engineering Guide (for Gemini Pro / Codex)

> [!TIP]
> Since you'll be using AI assistants to generate the actual code, here are optimized prompt templates for each phase. Break the work into small, focused prompts to avoid context-window issues.

### Prompt Template Rules

1. **One file per prompt** — Don't ask for all page objects at once
2. **Include the screen source** — Paste the relevant `.jsx` screen file so the AI can identify elements
3. **Specify the tech stack explicitly** — Every prompt should mention: "Appium 2, WebDriverIO v9, TypeScript, React Native Expo, Page Object Model"
4. **Include an example** — Give the AI one completed file as a reference pattern

### Recommended Prompt Sequence

```
PROMPT 1: "Setup wdio.conf.ts"
─────────────────────────────
"Create a WebDriverIO configuration file (wdio.conf.ts) for Appium 2 
testing of a React Native Expo Android app. 

Requirements:
- TypeScript
- Mocha framework
- UIAutomator2 automation
- APK path: ./android/app/build/outputs/apk/debug/app-debug.apk
- Auto-start Appium via @wdio/appium-service
- Screenshot on test failure
- Single worker (sequential tests)
- 120 second test timeout
- Port 4723

Include comments explaining each option."
```

```
PROMPT 2: "Create testProps helper"
───────────────────────────────────
"Create a TypeScript helper function called testProps() for a React Native app 
that returns both testID and accessibilityLabel for cross-platform Appium 
compatibility. Include Platform-specific handling for Android's 'accessible' prop.

File path: src/utils/testProps.ts
Export it as a named export."
```

```
PROMPT 3: "Instrument LoginScreen with testProps"
─────────────────────────────────────────────────
"I have a React Native LoginScreen component (attached below). Add testProps() 
calls to all interactive and important UI elements. 

Rules:
- Import testProps from '../utils/testProps'
- Use descriptive kebab-case IDs: 'login-vehicle-dropdown', 'login-driver-input', etc.
- Do NOT change any existing logic, styles, or behavior
- Only ADD the {...testProps('id')} spread to existing components

Here is the current LoginScreen.jsx:
[PASTE THE FILE CONTENT]"
```

```
PROMPT 4: "Create Login Page Object"
────────────────────────────────────
"Create a WebDriverIO Page Object for a React Native Login screen tested via 
Appium 2 + UIAutomator2.

The screen has these testID selectors:
- 'login-vehicle-dropdown'
- 'login-driver-input' 
- 'login-submit-button'
- 'login-language-switcher'
- 'login-alert-modal'

Pattern: Use the standard WebDriverIO Page Object pattern with:
- get selectors using $('~accessibility-id')
- Async action methods (selectVehicle, enterDriverCode, tapLogin)
- waitForDisplayed() calls in each method

Reference example (Splash page object):
[PASTE YOUR FIRST COMPLETED PAGE OBJECT]"
```

```
PROMPT 5: "Create login spec tests"  
───────────────────────────────────
"Write Mocha test specs for the GasTech Mobile login screen using WebDriverIO + 
Appium 2. Use the LoginPage page object (attached below).

Tests needed:
1. Login screen displays all required elements
2. Vehicle dropdown shows vehicle list on tap
3. Empty form submission shows validation alert
4. Valid credentials complete full login flow to dashboard

Use describe/it blocks with async/await.
Include beforeEach that resets to login screen.
Use environment variable TEST_DRIVER_CODE for credentials.
Skip authenticated tests if TEST_DRIVER_CODE is not set.

LoginPage source:
[PASTE PAGE OBJECT]"
```

```
PROMPT 6: "Create GitHub Actions workflow"
──────────────────────────────────────────
"Create a GitHub Actions workflow YAML for running Appium 2 + WebDriverIO tests 
on Android. 

Requirements:
- Trigger on push/PR to 'qa' branch
- Ubuntu runner with KVM acceleration
- Node 20, Java 17
- Build React Native Android debug APK (cd android && ./gradlew assembleDebug)
- Use reactivecircus/android-emulator-runner@v2 with API 33
- Install Appium + uiautomator2 driver
- Run 'npm run test:e2e'
- Upload test artifacts
- Fail the job if tests fail
- Include concurrency group to cancel duplicate runs"
```

---

## Verification Plan

### Automated Tests
1. **Local verification**: Run `npm run test:e2e:smoke` on emulator — app launches and splash completes
2. **Auth flow**: Run `npm run test:e2e:auth` — full login cycle works
3. **CI dry run**: Push to a feature branch with CI workflow targeting that branch temporarily, verify the emulator boots and APK installs

### Manual Verification
1. **Appium Inspector**: Connect to running app, verify all `testID` props are visible in the element tree
2. **Production app unchanged**: Build and deploy a production APK, verify no behavioral changes from `testProps()` additions
3. **Compare coverage**: Cross-reference all Playwright test cases against new Appium test cases — ensure nothing is lost

---

## Implementation Timeline

| Phase | Scope | Estimated Effort | Dependencies |
|---|---|---|---|
| **Phase 0** | Remove Playwright | 30 min | None |
| **Phase 1** | Local environment setup | 1–2 hours | Java, Android SDK, Appium |
| **Phase 2** | WDIO project scaffold | 1 hour | Phase 1 |
| **Phase 3** | wdio.conf.ts configuration | 30 min | Phase 2 |
| **Phase 4** | Instrument source with testProps | 3–4 hours | Phase 2 (can parallel) |
| **Phase 5a** | Smoke + Auth tests | 2–3 hours | Phase 3 + 4 (Tier 1) |
| **Phase 5b** | Navigation + Journeys | 2–3 hours | Phase 5a |
| **Phase 5c** | Business flows | 4–6 hours | Phase 5b |
| **Phase 5d** | API health tests | 30 min | None |
| **Phase 6** | CI/CD workflow | 1–2 hours | Phase 5a minimum |
| **Phase 7** | Documentation | 1–2 hours | All phases |

**Total: ~16–24 hours spread across 2–3 weeks**

---

## Risk Assessment (Live Production App)

| Risk | Mitigation |
|---|---|
| `testProps()` additions break production | `testID` and `accessibilityLabel` are metadata-only — they do NOT affect rendering, layout, or behavior. Verified safe. |
| Removing SplashScreen timeout hack breaks web build | The web build is not used in production. Only Playwright used it. Safe to remove. |
| CI pipeline is slower with emulator | Accept the tradeoff. Appium CI runs take 10–15 min vs 3–5 min for Playwright. The coverage quality is dramatically better. |
| Appium tests are flakier than Playwright | Mitigate with: explicit waits (never `sleep`), `noReset: false` capability, and retry-on-failure in CI. |
| Team learning curve | Phased rollout (smoke first) + Appium Inspector for debugging + AI-generated boilerplate reduces ramp-up time. |

---

## Learning Roadmap

For your personal learning while implementing:

1. **Day 1**: Install Appium + Inspector. Connect to your app. Explore the element tree manually.
2. **Day 2**: Write your first test (app launch smoke test) by hand — not AI-generated. Understand the flow.
3. **Day 3**: Use AI to generate Page Objects for Login screen. Review and understand every line.
4. **Day 4–5**: Implement auth tests. Debug failures using Appium Inspector.
5. **Week 2**: Navigation + journey tests. By now you should be comfortable with the patterns.
6. **Week 3**: CI/CD setup + documentation.

> [!TIP]
> **Appium Inspector is your best learning tool.** It shows you the exact element tree, lets you try selectors interactively, and even records actions into code. Spend significant time with it before writing test code.
