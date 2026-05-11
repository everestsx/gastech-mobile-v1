import { browser } from '@wdio/globals';

class MenuPage {
    async waitForLoaded() {
        await browser.pause(1000);
    }
}

export default new MenuPage();
