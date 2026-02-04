/**
 * Sync Manager: orchestrates API + local cache based on connectivity.
 * Online: fetch from API first, then persist to SQLite (48h cache).
 * Offline: read from SQLite only.
 * On API failure when online: fallback to SQLite.
 */

import { getCustomers } from './customer.service';
import { getAllSaleOrders } from './saleOrder.service';
import { getSaleOrderDetails, updateSaleOrderLineQty, confirmSaleOrder } from './saleOrderLine.service';
import {
  getPickingBySaleOrder,
  getMoveLines,
  updateMoveLineQty,
  validatePicking,
} from './delivery.service';
import {
  loadCustomersFromCache,
  loadOrdersFromCache,
  loadOrderDetailsFromCache,
  persistCustomers,
  persistOrders,
  persistOrderDetails,
  setLastSyncTime,
  getLastSyncTimeFromDb,
  getOfflineQueue,
  removeOfflineQueueItem,
  incrementQueueRetry,
} from './localStorage.service';

const MAX_QUEUE_RETRIES = 3;

/**
 * Get customers: online → API then save to cache, return data. Offline → read from cache (same shape as online).
 */
export async function getCustomersData(isOnline) {
  if (isOnline) {
    try {
      const data = await getCustomers();
      const list = Array.isArray(data) ? data : [];
      try {
        await persistCustomers(list);
        await setLastSyncTime(new Date().toISOString());
      } catch (e) {
        // still return list; cache write failed
      }
      return list;
    } catch (err) {
      console.warn('getCustomersData API failed, using cache:', err?.message);
    }
  }
  return loadCustomersFromCache();
}

/**
 * Get sale orders: online → API then save to cache, return data. Offline → read from cache (same shape as online).
 */
export async function getOrdersData(isOnline) {
  if (isOnline) {
    try {
      const data = await getAllSaleOrders();
      const list = Array.isArray(data) ? data : [];
      try {
        await persistOrders(list);
        await setLastSyncTime(new Date().toISOString());
      } catch (e) {
        // still return list; cache write failed
      }
      return list;
    } catch (err) {
      console.warn('getOrdersData API failed, using cache:', err?.message);
    }
  }
  return loadOrdersFromCache();
}

/**
 * Get order details: online → API then cache; offline or API fail → cache.
 */
export async function getOrderDetailsData(orderId, isOnline) {
  if (isOnline) {
    try {
      const { order, lines } = await getSaleOrderDetails(orderId);
      try {
        await persistOrderDetails(orderId, order, lines);
      } catch (e) {}
      return { order, lines };
    } catch (err) {
      console.warn('getOrderDetailsData API failed, using cache:', err?.message);
    }
  }
  const cached = await loadOrderDetailsFromCache(orderId);
  return cached || { order: null, lines: [] };
}

/**
 * Full sync (customers + orders). Only runs when online and API succeeds.
 * When offline: does nothing, cache is never touched.
 * When API fails: does NOT persist - keeps existing 48h data in DB.
 */
export async function runFullSync(isOnline = true) {
  const results = { customers: 0, orders: 0, error: null };
  if (isOnline === false) {
    results.error = 'Offline';
    return results;
  }
  try {
    const [customers, orders] = await Promise.all([
      getCustomers(),
      getAllSaleOrders(),
    ]);
    const custList = Array.isArray(customers) ? customers : [];
    const orderList = Array.isArray(orders) ? orders : [];
    await Promise.all([
      persistCustomers(custList),
      persistOrders(orderList),
      setLastSyncTime(new Date().toISOString()),
    ]);
    results.customers = custList.length;
    results.orders = orderList.length;
  } catch (err) {
    results.error = err?.message || 'Sync failed';
    // Do NOT persist - keep existing cache so data never disappears
  }
  return results;
}

export async function getLastSyncTime() {
  return getLastSyncTimeFromDb();
}

const ACTION_UPDATE_LINE_QTY = 'update_line_qty';
const ACTION_PAYMENT = 'payment';

async function processPaymentPayload(saleOrderId) {
  await confirmSaleOrder(saleOrderId);
  const pickings = await getPickingBySaleOrder(saleOrderId);
  if (!pickings?.length) throw new Error('No delivery order found');
  const picking = pickings[0];
  const moveLineIds = picking.move_line_ids || [];
  if (moveLineIds.length) {
    const moveLines = await getMoveLines(moveLineIds);
    for (const ml of moveLines || []) {
      const qty = ml.product_uom_qty ?? 0;
      if (qty > 0) await updateMoveLineQty(ml.id, qty);
    }
  }
  await validatePicking(picking.id);
}

/**
 * Process offline queue: push qty updates and payment/delivery to backend when back online.
 */
export async function processOfflineQueue() {
  let queue = [];
  try {
    queue = await getOfflineQueue();
  } catch (e) {
    return;
  }
  if (!Array.isArray(queue) || queue.length === 0) return;

  for (const item of queue) {
    const id = item.id;
    const action = item.action != null ? String(item.action) : '';
    let payload = item.payload;
    if (typeof payload === 'string') {
      try {
        payload = JSON.parse(payload);
      } catch {
        payload = null;
      }
    }
    try {
      if (action === ACTION_UPDATE_LINE_QTY && payload && payload.lineId != null && payload.qty != null) {
        await updateSaleOrderLineQty(Number(payload.lineId), Number(payload.qty));
        await removeOfflineQueueItem(id);
      } else if (action === ACTION_PAYMENT && payload && payload.saleOrderId != null) {
        await processPaymentPayload(Number(payload.saleOrderId));
        await removeOfflineQueueItem(id);
      }
    } catch (e) {
      const retryCount = (item.retry_count ?? 0) + 1;
      if (retryCount >= MAX_QUEUE_RETRIES) {
        await removeOfflineQueueItem(id);
      } else {
        await incrementQueueRetry(id);
      }
    }
  }
}

export { ACTION_UPDATE_LINE_QTY, ACTION_PAYMENT };
