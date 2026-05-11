import { browser } from '@wdio/globals';

class OrderDetailPage {
    async waitForLoaded() {
        await browser.pause(1000);
    }
}

export default new OrderDetailPage();
