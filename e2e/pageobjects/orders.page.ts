import { $ } from '@wdio/globals';

class OrdersPage {
    get searchInput() {
        return $('~saleorders-search-input');
    }

    get searchField() {
        // The search button that submits the search
        return $('~saleorders-search-field');
    }

    get ordersList() {
        return $('~saleorders-list');
    }

    async getFirstOrderCard() {
        return $('//*[contains(@content-desc, "saleorder-card-")]');
    }

    async waitForLoaded() {
        await this.ordersList.waitForDisplayed({ timeout: 15000 });
    }
}

export default new OrdersPage();
