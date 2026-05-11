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

    async waitForLoaded() {
        await this.vehicleDropdown.waitForDisplayed({ timeout: 30000 });
        await this.driverInput.waitForDisplayed({ timeout: 30000 });
    }

    async enterDriverCode(code: string) {
        await this.driverInput.setValue(code);
    }

    async tapLogin() {
        await this.submitButton.click();
    }
}

export default new LoginPage();
