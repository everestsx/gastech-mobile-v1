import { $ } from '@wdio/globals';
import { loginIfNeeded } from '../helpers/auth';

describe('Navigation - tabs', () => {
    before(async function () {
        // Need to be logged in to test tabs
        await loginIfNeeded();
    });

    it('navigates to Orders tab', async () => {
        const ordersTab = await $('~tab-orders');
        await ordersTab.click();
        
        const ordersList = await $('~saleorders-list');
        await ordersList.waitForDisplayed({ timeout: 10000 });
        await expect(ordersList).toBeDisplayed();
    });

    it('navigates to Delivered tab', async () => {
        const deliveredTab = await $('~tab-delivered');
        await deliveredTab.click();
        
        const deliveredList = await $('~delivered-list');
        await deliveredList.waitForDisplayed({ timeout: 10000 });
        await expect(deliveredList).toBeDisplayed();
    });

    it('navigates to Menu tab', async () => {
        const menuTab = await $('~tab-menu');
        await menuTab.click();
        
        const syncBtn = await $('~menu-sync-btn');
        await syncBtn.waitForDisplayed({ timeout: 10000 });
        await expect(syncBtn).toBeDisplayed();
    });

    it('navigates back to Dashboard tab', async () => {
        const dashboardTab = await $('~tab-dashboard');
        await dashboardTab.click();
        
        const dashboardProfile = await $('~dashboard-profile');
        await dashboardProfile.waitForDisplayed({ timeout: 10000 });
        await expect(dashboardProfile).toBeDisplayed();
    });
});
