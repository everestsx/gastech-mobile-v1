import LoginPage from '../pageobjects/login.page';

export const loginIfNeeded = async () => {
    // Check if we are already on the dashboard or if we need to login
    // If we are on the splash screen, wait for it to disappear
    const driverCode = process.env.TEST_DRIVER_CODE;
    if (!driverCode) {
        throw new Error('TEST_DRIVER_CODE must be set to run authenticated tests');
    }

    try {
        await LoginPage.waitForLoaded();
    } catch (e) {
        // Might already be logged in or on dashboard
        return;
    }

    const vehicleName = process.env.TEST_VEHICLE_NAME;
    await LoginPage.selectVehicle(vehicleName);
    await LoginPage.enterDriverCode(driverCode);
    await LoginPage.tapLogin();
    await LoginPage.completePorterSelection();

    const dashboardTab = await $('~dashboard-profile');
    await dashboardTab.waitForDisplayed({ timeout: 15000 });
};
