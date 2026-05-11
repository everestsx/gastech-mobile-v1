import { browser } from '@wdio/globals';

class OrdersPage {
    async waitForLoaded() {
        await browser.pause(1000);
    }
}

export default new OrdersPage();
