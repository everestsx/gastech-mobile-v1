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

    it('skips full login flow without credentials', async function () {
        if (!process.env.TEST_DRIVER_CODE) {
            this.skip();
        }
    });
});
