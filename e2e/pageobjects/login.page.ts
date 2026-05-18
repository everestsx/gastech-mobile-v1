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

    get alertOkButton() {
        return $('~login-alert-modal-ok');
    }

    async dismissAlert() {
        const okBtn = await this.alertOkButton;
        await okBtn.waitForDisplayed({ timeout: 5000 });
        await okBtn.click();
        // Wait for the modal to disappear
        await driver.pause(300);
    }

    async waitForLoaded() {
        await this.vehicleDropdown.waitForDisplayed({ timeout: 30000 });
        await this.driverInput.waitForDisplayed({ timeout: 30000 });
    }

    async selectVehicle(vehicleName?: string) {
        await this.vehicleDropdown.click();
        // Wait for dropdown animation
        await driver.pause(1000);
        
        if (vehicleName) {
            // Use Android UiScrollable to find the vehicle even if it's off-screen
            const scrollSelector = `android=new UiScrollable(new UiSelector().scrollable(true)).scrollIntoView(new UiSelector().textContains("${vehicleName}"))`;
            const targetVehicle = await $(scrollSelector);
            await targetVehicle.waitForDisplayed({ timeout: 10000 });
            await targetVehicle.click();
        } else {
            // Click the first vehicle item if no name provided
            const firstVehicle = await $('//*[contains(@content-desc, "login-vehicle-item-")]');
            await firstVehicle.waitForDisplayed({ timeout: 10000 });
            await firstVehicle.click();
        }
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
