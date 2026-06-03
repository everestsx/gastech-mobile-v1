import { $ } from '@wdio/globals';

/**
 * Invoice Screen page object — testID selectors only.
 *
 * Key flow (with EXPO_PUBLIC_E2E_SKIP_SIGNATURES=true):
 *   - Signature modal is skipped (dummy sigs injected at screen mount)
 *   - clickSkipPrint() → since openPaymentProofAfterPrint=true, navigates straight to PaymentProof
 */
class InvoicePage {
    get skipPrintBtn()      { return $('~invoice-skip-print'); }

    // Signature modal (only shown when EXPO_PUBLIC_E2E_SKIP_SIGNATURES is NOT set)
    get signatureModal()    { return $('~invoice-signature-modal'); }
    get sigTabCustomer()    { return $('~invoice-sig-tab-customer'); }
    get sigTabDriver()      { return $('~invoice-sig-tab-driver'); }
    get sigCanvas()         { return $('~invoice-sig-canvas'); }
    get sigSaveCustomer()   { return $('~invoice-sig-save-customer'); }
    get sigSaveDriver()     { return $('~invoice-sig-save-driver'); }
    get sigDone()           { return $('~invoice-sig-done'); }

    async waitForLoaded() {
        await this.skipPrintBtn.waitForDisplayed({ timeout: 20000 });
        await driver.pause(500);
    }

    async clickSkipPrint() {
        await this.skipPrintBtn.waitForDisplayed({ timeout: 10000 });
        await this.skipPrintBtn.click();
    }

    async isSignatureModalVisible() {
        try {
            return await this.signatureModal.isDisplayed();
        } catch {
            return false;
        }
    }

    /**
     * Draws a signature gesture on the canvas.
     * Only used when EXPO_PUBLIC_E2E_SKIP_SIGNATURES is not set.
     */
    async drawSignatureOnCanvas() {
        const canvas = this.sigCanvas;
        await canvas.waitForDisplayed({ timeout: 5000 });
        await driver.action('pointer')
            .move({ origin: canvas, x: 20, y: 20 })
            .down()
            .pause(100)
            .move({ origin: canvas, x: 120, y: 60 })
            .pause(100)
            .up()
            .perform();
        await driver.pause(500);
    }
}

export default new InvoicePage();
