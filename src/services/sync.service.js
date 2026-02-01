import AsyncStorage from '@react-native-async-storage/async-storage';
import { getCustomers } from './customer.service';
import { getAllSaleOrders } from './saleOrder.service';

const KEYS = {
  USER: '@gastech_user',
  CUSTOMERS: '@gastech_customers',
  ORDERS: '@gastech_orders',
  LAST_SYNC: '@gastech_last_sync',
};

const SYNC_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

export async function getUserSession() {
  try {
    const raw = await AsyncStorage.getItem(KEYS.USER);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function saveUserSession(user) {
  await AsyncStorage.setItem(KEYS.USER, JSON.stringify(user));
}

export async function logout() {
  await AsyncStorage.multiRemove([KEYS.USER, KEYS.LAST_SYNC]);
}

export async function getCachedCustomers() {
  try {
    const raw = await AsyncStorage.getItem(KEYS.CUSTOMERS);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function getCachedOrders() {
  try {
    const raw = await AsyncStorage.getItem(KEYS.ORDERS);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function runSync() {
  const results = { customers: 0, orders: 0, error: null };
  try {
    const [customers, orders] = await Promise.all([
      getCustomers(),
      getAllSaleOrders(),
    ]);
    await AsyncStorage.setItem(KEYS.CUSTOMERS, JSON.stringify(customers || []));
    await AsyncStorage.setItem(KEYS.ORDERS, JSON.stringify(orders || []));
    await AsyncStorage.setItem(KEYS.LAST_SYNC, new Date().toISOString());
    results.customers = (customers || []).length;
    results.orders = (orders || []).length;
  } catch (err) {
    results.error = err?.message || 'Sync failed';
  }
  return results;
}

export async function getLastSyncTime() {
  return AsyncStorage.getItem(KEYS.LAST_SYNC);
}

export function getSyncIntervalMs() {
  return SYNC_INTERVAL_MS;
}

export function getSyncIntervalMinutes() {
  return SYNC_INTERVAL_MS / 60000;
}
