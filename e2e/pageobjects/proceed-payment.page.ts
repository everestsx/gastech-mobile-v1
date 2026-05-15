import { $ } from '@wdio/globals';

class ProceedPaymentPage {
    get methodCash() {
        return $('~proceedpayment-method-cash');
    }

    get methodCheque() {
        return $('~proceedpayment-method-cheque');
    }

    get methodCredit() {
        return $('~proceedpayment-method-credit');
    }

    get cashInput() {
        return $('~proceedpayment-cash-input');
    }

    get chequeInput() {
        return $('~proceedpayment-cheque-input');
    }

    get bankSearch() {
        return $('~proceedpayment-bank-search');
    }

    get chequeNumber() {
        return $('~proceedpayment-cheque-number');
    }

    get confirmBtn() {
        return $('~proceedpayment-confirm');
    }

    async waitForLoaded() {
        await this.confirmBtn.waitForDisplayed({ timeout: 15000 });
    }
}

export default new ProceedPaymentPage();
