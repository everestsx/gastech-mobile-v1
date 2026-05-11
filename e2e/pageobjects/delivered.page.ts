import { browser } from '@wdio/globals';

class DeliveredPage {
    async waitForLoaded() {
        await browser.pause(1000);
    }
}

export default new DeliveredPage();
