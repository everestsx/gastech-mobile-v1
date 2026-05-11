import { $ } from '@wdio/globals';

class DashboardPage {
    get profile() {
        return $('~dashboard-profile');
    }

    get routePicker() {
        return $('~dashboard-route-picker');
    }

    get syncIndicator() {
        return $('~dashboard-sync-indicator');
    }

    get collectionCash() {
        return $('~dashboard-collection-cash');
    }

    get collectionCheque() {
        return $('~dashboard-collection-cheque');
    }

    get collectionCredit() {
        return $('~dashboard-collection-credit');
    }

    get ordersCompleted() {
        return $('~dashboard-orders-completed');
    }

    get gasDelivered() {
        return $('~dashboard-gas-delivered');
    }

    get createOrder() {
        return $('~dashboard-create-order');
    }

    get returnOrder() {
        return $('~dashboard-return-order');
    }

    async waitForLoaded() {
        await this.profile.waitForDisplayed({ timeout: 30000 });
    }
}

export default new DashboardPage();
