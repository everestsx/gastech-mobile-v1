import { $ } from '@wdio/globals';

/**
 * Payment Proof Screen page object — testID selectors only.
 *
 * For cash payment, creditProofRequired = false → canComplete = true
 * → "Complete payment" button is enabled without any photo upload.
 */
class PaymentProofPage {
    get completeBtn()     { return $('~paymentproof-complete'); }
    get confirmModal()    { return $('~paymentproof-confirm-modal'); }
    get confirmYesBtn()   { return $('~paymentproof-confirm-yes'); }
    get confirmKeepBtn()  { return $('~paymentproof-confirm-keep'); }

    async waitForLoaded() {
        await this.completeBtn.waitForDisplayed({ timeout: 20000 });
        await driver.pause(500);
    }

    async completeOrder() {
        await this.completeBtn.click();
        await this.confirmModal.waitForDisplayed({ timeout: 8000 });
        await this.confirmYesBtn.click();
    }
}

export default new PaymentProofPage();
