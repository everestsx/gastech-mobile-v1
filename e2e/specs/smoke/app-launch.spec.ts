import LoginPage from '../../pageobjects/login.page';

describe('Smoke - app launch', () => {
    it('launches and reaches login screen', async () => {
        // Instead of waiting for transient splash screen, 
        // we wait for the login screen which is the proof the app is ready.
        await LoginPage.waitForLoaded();
        await expect(LoginPage.vehicleDropdown).toBeDisplayed();
    });
});
