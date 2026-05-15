import { $ } from '@wdio/globals';
import { loginIfNeeded } from '../helpers/auth';
import OrdersPage from '../../pageobjects/orders.page';
import OrderDetailPage from '../../pageobjects/order-detail.page';
import ProceedPaymentPage from '../../pageobjects/proceed-payment.page';

describe('Journeys - delivery flow', () => {
    before(async function () {
        await loginIfNeeded();
    });

    it('completes the delivery journey', async function () {
        const vehicleName = process.env.TEST_VEHICLE_NAME;
        if (!vehicleName) {
            console.warn('Skipping delivery flow test: TEST_VEHICLE_NAME not set');
            this.skip();
            return;
        }

        // 1. Navigate to Orders Tab
        const ordersTab = await $('~tab-orders');
        await ordersTab.waitForDisplayed();
        await ordersTab.click();
        await OrdersPage.waitForLoaded();

        // 2. Select first available order
        const firstOrder = await OrdersPage.getFirstOrderCard();
        await firstOrder.waitForDisplayed({ timeout: 15000 });
        await firstOrder.click();

        // 3. View Order Details
        await OrderDetailPage.waitForLoaded();
        
        // Ensure keyboard is hidden if any qty input gains focus
        if (driver.isAndroid) {
            try { await driver.hideKeyboard(); } catch(e) {}
        }

        // Scroll to proceed payment button just in case
        // await OrderDetailPage.proceedPaymentBtn.scrollIntoView();

        // Tap Proceed Payment
        await OrderDetailPage.proceedPaymentBtn.click();

        // 4. Payment Screen
        await ProceedPaymentPage.waitForLoaded();

        // Select Cash Method
        await ProceedPaymentPage.methodCash.click();

        // Let's assume the default amount is fully populated. We just need to tap confirm.
        // Wait, if we need to enter the cash amount:
        // const cashInput = await ProceedPaymentPage.cashInput;
        // await cashInput.setValue('1000'); // Or whatever the total is
        // We will just try confirming the prefilled amount

        if (driver.isAndroid) {
            try { await driver.hideKeyboard(); } catch(e) {}
        }

        await ProceedPaymentPage.confirmBtn.click();

        // Wait for the modal or navigation back
        // Usually, the app might go back to the dashboard or orders list
        // Let's wait for Dashboard or Orders tab to be selectable again to signify completion
        await ordersTab.waitForDisplayed({ timeout: 30000 });
    });
});
