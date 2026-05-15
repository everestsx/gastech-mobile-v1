import LoginPage from '../../pageobjects/login.page';

describe('Auth - login', () => {
    beforeEach(async () => {
        await LoginPage.waitForLoaded();
    });

    it('shows required login elements', async () => {
        await expect(LoginPage.vehicleDropdown).toBeDisplayed();
        await expect(LoginPage.driverInput).toBeDisplayed();
        await expect(LoginPage.submitButton).toBeDisplayed();
        await expect(LoginPage.languageSwitcher).toBeDisplayed();
    });

    it('shows vehicle list on tap', async () => {
        await LoginPage.vehicleDropdown.click();
        const firstVehicle = await $('//*[contains(@content-desc, "login-vehicle-item-")]');
        await expect(firstVehicle).toBeDisplayed();
        
        // Dismiss dropdown by clicking background or selecting an item
        await firstVehicle.click();
    });

    it('shows validation alert on empty form submission', async () => {
        // Need to make sure input is empty
        await LoginPage.driverInput.clearValue();
        await LoginPage.tapLogin();
        
        // Wait for CustomAlert to appear
        const alertModal = await LoginPage.alertModal;
        await alertModal.waitForDisplayed({ timeout: 5000 });
        await expect(alertModal).toBeDisplayed();

        // Dismiss the alert by tapping the OK button
        await LoginPage.dismissAlert();
    });

    it('completes full login flow to dashboard', async function () {
        const driverCode = process.env.TEST_DRIVER_CODE;
        if (!driverCode) {
            console.warn('Skipping full login test: TEST_DRIVER_CODE not set');
            this.skip();
            return;
        }

        const vehicleName = process.env.TEST_VEHICLE_NAME;
        // 1. Select vehicle
        await LoginPage.selectVehicle(vehicleName);
        
        // 2. Enter code
        await LoginPage.enterDriverCode(driverCode);
        
        // 3. Submit
        await LoginPage.tapLogin();
        
        // 4. Driver Review & Porter selection
        await LoginPage.completePorterSelection();

        // 5. Verify we reached Dashboard (Dashboard element visible)
        // Wait for dashboard to load
        const dashboardTab = await $('~dashboard-profile');
        await dashboardTab.waitForDisplayed({ timeout: 15000 });
        await expect(dashboardTab).toBeDisplayed();
    });
});
