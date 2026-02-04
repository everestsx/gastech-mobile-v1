/**
 * Local storage layer: reads/writes to SQLite cache.
 * Used by sync manager when offline or to persist after API success.
 */

import {
  getCustomersFromDb,
  getSaleOrdersFromDb,
  getOrderDetailsFromDb,
  saveCustomers,
  saveSaleOrders,
  saveOrderDetails,
  updateOrderDetailsLines,
  setMetadata,
  getMetadata,
  getOfflineQueue,
  enqueueOfflineAction,
  removeOfflineQueueItem,
  incrementQueueRetry,
} from '../database/database';

export async function loadCustomersFromCache() {
  try {
    return await getCustomersFromDb();
  } catch (e) {
    return [];
  }
}

export async function loadOrdersFromCache() {
  try {
    return await getSaleOrdersFromDb();
  } catch (e) {
    return [];
  }
}

export async function loadOrderDetailsFromCache(orderId) {
  try {
    return await getOrderDetailsFromDb(orderId);
  } catch (e) {
    return null;
  }
}

export async function persistCustomers(customers) {
  await saveCustomers(customers);
}

export async function persistOrders(orders) {
  await saveSaleOrders(orders);
}

export async function persistOrderDetails(orderId, order, lines) {
  await saveOrderDetails(orderId, order, lines);
}

/** Update cached order lines (e.g. after offline qty change). */
export async function updateOrderDetailsLinesInCache(orderId, lines) {
  await updateOrderDetailsLines(orderId, lines);
}

export async function setLastSyncTime(isoString) {
  await setMetadata('last_sync', isoString);
}

export async function getLastSyncTimeFromDb() {
  return getMetadata('last_sync');
}

export {
  getOfflineQueue,
  enqueueOfflineAction,
  removeOfflineQueueItem,
  incrementQueueRetry,
};
