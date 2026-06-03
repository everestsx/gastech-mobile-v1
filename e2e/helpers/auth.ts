import LoginPage from '../pageobjects/login.page';

/**
 * Waits for the "You're all synced" / "Great" modal to appear and dismisses it.
 *
 * Strategy:
 *  - Post-login sync can take anywhere from 2 to 30+ seconds.
 *  - We wait up to `timeoutMs` for the button to become visible.
 *  - If it never appears, we assume no sync completed and move on.
 */
const dismissSyncPopupIfPresent = async (timeoutMs = 30000) => {
    try {
        const dismissBtn = await $('~sync-success-dismiss');
        // waitForDisplayed will throw if the element isn't found in time.
        await dismissBtn.waitForDisplayed({ timeout: timeoutMs });
        await dismissBtn.click();
        console.log(`[auth] Dismissed sync-success modal.`);
        await driver.pause(800);
    } catch (e) {
        // Modal did not appear within the timeout — that's fine, continue.
        console.log(`[auth] No sync-success modal within ${timeoutMs}ms, continuing.`);
    }
};

export const loginIfNeeded = async () => {
    const driverCode = process.env.TEST_DRIVER_CODE;
    if (!driverCode) {
        throw new Error('TEST_DRIVER_CODE must be set to run authenticated tests');
    }

    try {
        await LoginPage.waitForLoaded();
    } catch (e) {
        // Already on dashboard (app was already logged in).
        // Still try to dismiss any lingering sync popup with a short window.
        await dismissSyncPopupIfPresent(5000);
        return;
    }

    const vehicleName = process.env.TEST_VEHICLE_NAME;
    await LoginPage.selectVehicle(vehicleName);
    await LoginPage.enterDriverCode(driverCode);
    await LoginPage.tapLogin();
    await LoginPage.completePorterSelection();

    // Wait for dashboard profile to appear — indicates successful login.
    const dashboardProfile = await $('~dashboard-profile');
    await dashboardProfile.waitForDisplayed({ timeout: 20000 });

    // Now wait for the post-login sync popup (up to 30s — sync is network-dependent).
    await dismissSyncPopupIfPresent(30000);
};
