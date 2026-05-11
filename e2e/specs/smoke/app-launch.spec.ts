import SplashPage from '../../pageobjects/splash.page';
import LoginPage from '../../pageobjects/login.page';

describe('Smoke - app launch', () => {
    it('launches and reaches login', async () => {
        await SplashPage.waitForVisible();
        await LoginPage.waitForLoaded();
    });
});
