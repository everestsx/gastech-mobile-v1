import { $ } from '@wdio/globals';

class EmptyCylinderPage {
    get continueBtn() { return $('~emptycylinder-continue'); }

    async waitForLoaded() {
        await this.continueBtn.waitForDisplayed({ timeout: 15000 });
        await driver.pause(500);
    }

    async clickContinue() {
        await this.waitForLoaded();
        await this.continueBtn.click();
    }
}

export default new EmptyCylinderPage();
