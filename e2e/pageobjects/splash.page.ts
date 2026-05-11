import { $ } from '@wdio/globals';

class SplashPage {
    get logo() {
        return $('~splash-logo');
    }

    get brandText() {
        return $('~splash-brand-text');
    }

    get spinner() {
        return $('~splash-spinner');
    }

    async waitForVisible() {
        await this.brandText.waitForDisplayed({ timeout: 30000 });
    }
}

export default new SplashPage();
