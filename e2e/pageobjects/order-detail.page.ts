import { $ } from '@wdio/globals';

class OrderDetailPage {
    get proceedPaymentBtn() {
        return $('~saleorderdetail-proceed-payment');
    }

    get modifyBtn() {
        return $('~saleorderdetail-modify');
    }

    get saveBtn() {
        return $('~saleorderdetail-save');
    }

    get cancelBtn() {
        return $('~saleorderdetail-cancel');
    }

    async getQtyInput(lineId: string | number) {
        return $(`~saleorderdetail-qty-${lineId}`);
    }

    async waitForLoaded() {
        await this.proceedPaymentBtn.waitForDisplayed({ timeout: 15000 });
    }
}

export default new OrderDetailPage();
