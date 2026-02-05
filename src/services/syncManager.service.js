/**
 * Sync Manager: orchestrates API + local cache based on connectivity.
 * Online: fetch from API first, then persist to SQLite (48h cache).
 * Offline: read from SQLite only.
 * On API failure when online: fallback to SQLite.
 */

import { getCustomers } from './customer.service';
import { getAllSaleOrders } from './saleOrder.service';
import { getSaleOrderDetails, getSaleOrderLinesBatch, updateSaleOrderLineQty, confirmSaleOrder } from './saleOrderLine.service';
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
  loadOrderFromListCache,
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

/** Only use API when definitely online (true). null/undefined/false → use cache. */
function shouldUseApi(isOnline) {
  return isOnline === true;
}

/** Persist order details for every order in the list so offline can open any order. */
async function persistOrderDetailsForList(orders) {
  if (!Array.isArray(orders) || orders.length === 0) return;
  const orderIds = orders.map((o) => o.id).filter((id) => id != null);
  if (orderIds.length === 0) return;
  try {
    const lines = await getSaleOrderLinesBatch(orderIds);
    const byOrderId = {};
    for (const line of lines || []) {
      const oid = Array.isArray(line.order_id) ? line.order_id[0] : line.order_id;
      if (oid == null) continue;
      if (!byOrderId[oid]) byOrderId[oid] = [];
      byOrderId[oid].push(line);
    }
    for (const order of orders) {
      const id = order.id;
      if (id == null) continue;
      const orderLines = byOrderId[id] || [];
      try {
        await persistOrderDetails(id, order, orderLines);
      } catch (e) {
        // skip one order, continue with rest
      }
    }
  } catch (e) {
    console.warn('persistOrderDetailsForList failed:', e?.message);
  }
}

/**
 * Get customers: online → API then save to cache, return data. Offline/unknown → read from cache (same shape as online).
 */
export async function getCustomersData(isOnline) {
  if (shouldUseApi(isOnline)) {
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
 * Filter orders by vehicle_id when user is vehicle driver.
 */
function filterOrdersByVehicle(orders, vehicleId) {
  if (vehicleId == null || !Array.isArray(orders)) return orders;
  return orders.filter((o) => {
    const vid = o.vehicle_id;
    const id = Array.isArray(vid) ? vid[0] : vid;
    return id === vehicleId;
  });
}

/**
 * Get sale orders: online → API then save to cache, return data (filtered by vehicle if vehicle user).
 * Offline/unknown → read from cache, filter by vehicle if vehicle user.
 */
export async function getOrdersData(isOnline, vehicleId = null) {
  if (shouldUseApi(isOnline)) {
    try {
      const data = await getAllSaleOrders();
      const list = Array.isArray(data) ? data : [];
      try {
        await persistOrders(list);
        await persistOrderDetailsForList(list);
        await setLastSyncTime(new Date().toISOString());
      } catch (e) {
        // still return list; cache write failed
      }
      return filterOrdersByVehicle(list, vehicleId);
    } catch (err) {
      console.warn('getOrdersData API failed, using cache:', err?.message);
    }
  }
  const cached = await loadOrdersFromCache();
  return filterOrdersByVehicle(cached || [], vehicleId);
}

/**
 * Get order details: online → API then cache; offline/unknown or API fail → cache.
 */
export async function getOrderDetailsData(orderId, isOnline) {
  if (shouldUseApi(isOnline)) {
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
  let cached = await loadOrderDetailsFromCache(orderId);
  if (cached) return cached;
  const orderFromList = await loadOrderFromListCache(orderId);
  if (orderFromList) return { order: orderFromList, lines: [] };
  return { order: null, lines: [] };
}

/**
 * Full sync (customers + orders). Only runs when online and API succeeds.
 * When offline: does nothing, cache is never touched.
 * When API fails: does NOT persist - keeps existing 48h data in DB.
 */
export async function runFullSync(isOnline = true) {
  const results = { customers: 0, orders: 0, error: null };
  if (!shouldUseApi(isOnline)) {
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
    await persistCustomers(custList);
    await persistOrders(orderList);
    await persistOrderDetailsForList(orderList);
    await setLastSyncTime(new Date().toISOString());
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
