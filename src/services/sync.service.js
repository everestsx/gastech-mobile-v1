import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getCustomersData,
  getOrdersData,
  runFullSync,
  getLastSyncTime as getLastSyncFromManager,
  processOfflineQueue,
} from './syncManager.service';

const KEYS = {
  USER: '@gastech_user',
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

/**
 * Get customers. When online uses API then cache; when offline uses SQLite cache.
 * @param {boolean} isOnline - from useNetwork().isOnline
 */
export async function getCachedCustomers(isOnline = true) {
  return getCustomersData(isOnline);
}

/**
 * Get sale orders. When online uses API then cache (48h); when offline uses SQLite cache.
 * @param {boolean} isOnline - from useNetwork().isOnline
 */
export async function getCachedOrders(isOnline = true) {
  return getOrdersData(isOnline);
}

/**
 * Run full sync (customers + orders). When online updates SQLite cache.
 * When offline (isOnline === false) does nothing - cache is never touched.
 */
export async function runSync(isOnline = true) {
  return runFullSync(isOnline);
}

/**
 * Process queued offline actions (e.g. qty updates) and push to backend. Call when back online.
 */
export async function runProcessOfflineQueue() {
  return processOfflineQueue();
}

export async function getLastSyncTime() {
  return getLastSyncFromManager();
}

export function getSyncIntervalMs() {
  return SYNC_INTERVAL_MS;
}

export function getSyncIntervalMinutes() {
  return SYNC_INTERVAL_MS / 60000;
}
