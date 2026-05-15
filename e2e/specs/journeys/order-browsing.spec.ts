import { $ } from '@wdio/globals';
import { loginIfNeeded } from '../helpers/auth';
import OrdersPage from '../../pageobjects/orders.page';

describe('Journeys - order browsing', () => {
    before(async function () {
        await loginIfNeeded();
    });

    it('navigates to Orders tab and views list', async () => {
        const ordersTab = await $('~tab-orders');
        await ordersTab.click();
        
        await OrdersPage.waitForLoaded();
    });

    it('can type into search box', async () => {
        await OrdersPage.searchInput.waitForDisplayed();
        await OrdersPage.searchInput.setValue('Test');
        
        // Hide keyboard
        if (driver.isAndroid) {
            await driver.hideKeyboard();
        }
        
        // Clear it back
        await OrdersPage.searchInput.clearValue();
    });

    it('can select an order from the list', async () => {
        const firstOrder = await OrdersPage.getFirstOrderCard();
        await firstOrder.waitForDisplayed({ timeout: 15000 });
        
        // Click the first order
        await firstOrder.click();
        
        // Verify it navigated to details screen by waiting for the proceed payment button
        const proceedPaymentBtn = await $('~saleorderdetail-proceed-payment');
        await proceedPaymentBtn.waitForDisplayed({ timeout: 10000 });
        await expect(proceedPaymentBtn).toBeDisplayed();
        
        // Go back to orders list
        const backBtn = await $('~header-back'); // We don't have a testID for header back, might need to use generic accessibility label
        // Actually, navigation headers have accessibility labels based on headerBackTitle
        // Or we can just let it stay on the details screen as the end of this journey.
    });
});
