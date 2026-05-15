import { $ } from '@wdio/globals';

class LoginPage {
    get vehicleDropdown() {
        return $('~login-vehicle-dropdown');
    }

    get driverInput() {
        return $('~login-driver-input');
    }

    get submitButton() {
        return $('~login-submit-button');
    }

    get languageSwitcher() {
        return $('~login-language-switcher');
    }

    get alertModal() {
        return $('~login-alert-modal');
    }

    get driverReviewContinue() {
        return $('~login-driver-review-continue');
    }

    get driverReviewBack() {
        return $('~login-driver-review-back');
    }

    get porterSearch() {
        return $('~login-porter-search');
    }

    get porterFinishButton() {
        return $('~login-porter-finish');
    }

    get alertModalClose() {
        // Assuming CustomAlert has a standard 'OK' button, or we can just tap the background.
        // Let's rely on the alert modal being visible.
        return $('~login-alert-modal');
    }

    async waitForLoaded() {
        await this.vehicleDropdown.waitForDisplayed({ timeout: 30000 });
        await this.driverInput.waitForDisplayed({ timeout: 30000 });
    }

    async selectFirstVehicle() {
        await this.vehicleDropdown.click();
        // Wait for dropdown animation
        await driver.pause(500);
        // Click the first vehicle item using XPath since IDs are dynamic, 
        // or just click the first one that appears containing 'login-vehicle-item'
        const firstVehicle = await $('//*[contains(@content-desc, "login-vehicle-item-")]');
        await firstVehicle.waitForDisplayed();
        await firstVehicle.click();
    }

    async enterDriverCode(code: string) {
        await this.driverInput.setValue(code);
        // Hide keyboard on Android
        if (driver.isAndroid) {
            await driver.hideKeyboard();
        }
    }

    async tapLogin() {
        await this.submitButton.click();
    }

    async completePorterSelection() {
        await this.driverReviewContinue.waitForDisplayed({ timeout: 10000 });
        await this.driverReviewContinue.click();
        
        await this.porterFinishButton.waitForDisplayed({ timeout: 10000 });
        // Select first porter
        const firstPorter = await $('//*[contains(@content-desc, "login-porter-item-")]');
        await firstPorter.waitForDisplayed();
        await firstPorter.click();

        await this.porterFinishButton.click();
    }
}

export default new LoginPage();
