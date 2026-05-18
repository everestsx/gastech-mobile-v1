import { $ } from '@wdio/globals';
import { loginIfNeeded } from '../helpers/auth';
import OrdersPage from '../../pageobjects/orders.page';
import OrderDetailPage from '../../pageobjects/order-detail.page';
import ProceedPaymentPage from '../../pageobjects/proceed-payment.page';

describe('Full App Journey', () => {
    before(async function () {
        // Run login once for all tests in this file
        await loginIfNeeded();
    });

    it('Scenario 1: Tab Navigation', async () => {
        // Dashboard is already visible from loginIfNeeded
        
        const ordersTab = await $('~tab-orders');
        await ordersTab.click();
        const ordersList = await $('~saleorders-list');
        await ordersList.waitForDisplayed({ timeout: 10000 });

        const deliveredTab = await $('~tab-delivered');
        await deliveredTab.click();
        const deliveredList = await $('~delivered-list');
        await deliveredList.waitForDisplayed({ timeout: 10000 });

        const menuTab = await $('~tab-menu');
        await menuTab.click();
        const syncBtn = await $('~menu-sync-btn');
        await syncBtn.waitForDisplayed({ timeout: 10000 });

        const dashboardTab = await $('~tab-dashboard');
        await dashboardTab.click();
        await $('~dashboard-profile').waitForDisplayed({ timeout: 10000 });
    });

    it('Scenario 2: Order Search and Selection', async () => {
        const ordersTab = await $('~tab-orders');
        await ordersTab.click();
        await OrdersPage.waitForLoaded();

        await OrdersPage.searchInput.setValue('Test');
        if (driver.isAndroid) await driver.hideKeyboard();
        await OrdersPage.searchInput.clearValue();

        const firstOrder = await OrdersPage.getFirstOrderCard();
        await firstOrder.waitForDisplayed({ timeout: 15000 });
        await firstOrder.click();

        await OrderDetailPage.waitForLoaded();
        await expect(OrderDetailPage.proceedPaymentBtn).toBeDisplayed();
    });

    it('Scenario 3: Delivery and Payment Flow', async function () {
        const vehicleName = process.env.TEST_VEHICLE_NAME;
        if (!vehicleName) {
            this.skip();
            return;
        }

        // We are already on Order Details from Scenario 2
        await OrderDetailPage.proceedPaymentBtn.click();

        await ProceedPaymentPage.waitForLoaded();
        await ProceedPaymentPage.methodCash.click();

        if (driver.isAndroid) {
            try { await driver.hideKeyboard(); } catch(e) {}
        }

        await ProceedPaymentPage.confirmBtn.click();
        
        // Wait for navigation back to orders
        const ordersTab = await $('~tab-orders');
        await ordersTab.waitForDisplayed({ timeout: 30000 });
        await expect(ordersTab).toBeDisplayed();
    });
});
