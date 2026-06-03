import { $ } from '@wdio/globals';
import { loginIfNeeded } from '../../helpers/auth';
import OrdersPage from '../../pageobjects/orders.page';
import OrderDetailPage from '../../pageobjects/order-detail.page';
import ProceedPaymentPage from '../../pageobjects/proceed-payment.page';
import EmptyCylinderPage from '../../pageobjects/empty-cylinder.page';
import InvoicePage from '../../pageobjects/invoice.page';
import PaymentProofPage from '../../pageobjects/payment-proof.page';

/**
 * Click the "Great" button on the sync-success popup if it appears.
 *
 * With EXPO_PUBLIC_E2E_MODE=true the popup is suppressed at source and will
 * never appear — so this call costs only the 500 ms timeout and moves on.
 * Kept as a safety net for builds without the flag.
 */
const dismissSyncModal = async (timeoutMs = 500) => {
    try {
        await $('~sync-success-dismiss').waitForDisplayed({ timeout: timeoutMs });
        await $('~sync-success-dismiss').click();   // presses the "Great" button
        await driver.pause(400);
    } catch {
        // popup not present — continue
    }
};

describe('Full App Journey', () => {

    before(async function () {
        await loginIfNeeded();
        await driver.pause(1000);
    });

    beforeEach(async function () {
        await dismissSyncModal(500);
    });

    // ────────────────────────────────────────────────────────────────
    it('Scenario 1: Tab Navigation', async () => {
        await $('~tab-orders').waitForDisplayed({ timeout: 10000 });
        await $('~tab-orders').click();
        await $('~saleorders-list').waitForDisplayed({ timeout: 15000 });

        await $('~tab-delivered').waitForDisplayed({ timeout: 10000 });
        await $('~tab-delivered').click();
        await $('~delivered-list').waitForDisplayed({ timeout: 15000 });

        await $('~tab-menu').waitForDisplayed({ timeout: 10000 });
        await $('~tab-menu').click();
        await $('~menu-sync-btn').waitForDisplayed({ timeout: 15000 });

        await $('~tab-dashboard').waitForDisplayed({ timeout: 10000 });
        await $('~tab-dashboard').click();
        await dismissSyncModal(3000);
        await $('~dashboard-profile').waitForDisplayed({ timeout: 15000 });
    });

    // ────────────────────────────────────────────────────────────────
    it('Scenario 2: Order Search and Selection', async () => {
        await $('~tab-orders').waitForDisplayed({ timeout: 10000 });
        await $('~tab-orders').click();
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

    // ────────────────────────────────────────────────────────────────
    it('Scenario 3: Delivery and Payment Flow', async function () {

        // ── 1. Proceed Payment ──────────────────────────────────────
        await OrderDetailPage.proceedPaymentBtn.click();

        await ProceedPaymentPage.waitForLoaded();
        await ProceedPaymentPage.methodCash.click();
        if (driver.isAndroid) {
            try { await driver.hideKeyboard(); } catch { }
        }
        await ProceedPaymentPage.confirmBtn.click();
        await driver.pause(2000);

        // ── 2. Empty Cylinder Collection ────────────────────────────
        await EmptyCylinderPage.clickContinue();
        await driver.pause(2000);

        // ── 3. Invoice Screen ───────────────────────────────────────
        await InvoicePage.waitForLoaded();

        if (await InvoicePage.isSignatureModalVisible()) {
            await InvoicePage.drawSignatureOnCanvas();
            await InvoicePage.sigSaveCustomer.click();
            await driver.pause(500);
            await InvoicePage.sigTabDriver.click();
            await driver.pause(500);
            await InvoicePage.drawSignatureOnCanvas();
            await InvoicePage.sigSaveDriver.click();
            await driver.pause(500);
            await InvoicePage.sigDone.click();
            await driver.pause(1000);
        }

        await InvoicePage.clickSkipPrint();
        await driver.pause(2000);

        // ── 4. Payment Proof ────────────────────────────────────────
        await PaymentProofPage.waitForLoaded();
        await PaymentProofPage.completeOrder();

        // ── 5. Back on Dashboard ─────────────────────────────────────
        await dismissSyncModal(3000);
        await $('~dashboard-profile').waitForDisplayed({ timeout: 30000 });

        // ── 6. Wait for background sync to finish ────────────────────
        // The order is saved locally on completeOrder(). The background sync
        // pushes it to Odoo. Give it up to 15 s before the session ends so
        // the APK isn't killed mid-upload.
        console.log('[spec] ✅ Order complete — waiting for background sync...');
        await driver.pause(15000);
        console.log('[spec] ✅ Sync window done. Test finished.');
    });
});
