/**
 * Offline-first sync: pull from Odoo into SQLite, serve all data from local DB.
 * Sync = fetch from backend and store; app reads only from DB.
 */
import { getCustomers, getPartnersByIds } from './customer.service';
import { getAllSaleOrders, getSaleOrdersByVehicle } from './saleOrder.service';
import { getAllProducts, getProductsByIds, getMandatoryEmptyCylinderProducts } from './product.service';
import { getJournals } from './journal.service';
import { getRoutes } from './route.service';
import { getVehicles, getVehicleById } from './vehicle.service';
import { getStockLocationByVehicle, getStockWarehouses } from './vehicleWarehouse.service';
import { getVehicleInventoryByLocation } from './vehicleInventory.service';
import * as partnersDb from '../database/partners.js';
import * as saleOrdersDb from '../database/saleOrders.js';
import * as saleOrderLinesDb from '../database/saleOrderLines.js';
import * as stockPickingsDb from '../database/stockPickings.js';
import * as stockMovesDb from '../database/stockMoves.js';
import * as stockMoveLinesDb from '../database/stockMoveLines.js';
import * as journalsDb from '../database/journals.js';
import * as routesDb from '../database/routes.js';
import * as vehiclesDb from '../database/vehicles.js';
import * as vehicleWarehousesDb from '../database/vehicleWarehouses.js';
import * as vehicleInventoriesDb from '../database/vehicleInventories.js';
import * as productsDb from '../database/products.js';
import * as syncLogDb from '../database/syncLog.js';
import * as syncQueueDb from '../database/syncQueue.js';
import { getDb } from '../database/db.js';
export let isLoggingOut = false;
export const setIsLoggingOut = (value) => {
  isLoggingOut = value;
};

/** Optional listener for sync state (true = syncing, false = idle). Used by SyncContext for global indicator. */
let _syncStateListener = null;
export function setSyncStateListener(fn) {
  _syncStateListener = fn;
}

/** Optional listener called when sync completes (success or error). Used by Dashboard to refresh data and last sync time. */
let _syncCompleteListener = null;
export function setSyncCompleteListener(fn) {
  _syncCompleteListener = fn;
}
/** In-flight queue processor; concurrent callers await the same promise (do not skip uploads). */
let _processSyncQueuePromise = null;
/** Edge-case recovery: keep retrying pending queue rows after flaky network (does not change enqueue/workflow). */
const QUEUE_SYNC_RETRY_WINDOW_MS = 12 * 60 * 1000;
const QUEUE_SYNC_RETRY_PASS_DELAY_MS = 900;
/** When a pass clears some rows, retry quickly (stable connection). */
const QUEUE_SYNC_FAST_PASS_DELAY_MS = 400;
/** Tighter retry spacing when queue is draining on a stable connection. */
const QUEUE_SYNC_AGGRESSIVE_PASS_DELAY_MS = 200;
const QUEUE_SYNC_MAX_PASSES = 30;
/** Fast retry for pending queue when app is foregrounded (AppNavigator). */
export const PENDING_QUEUE_FAST_RETRY_MS = 10 * 1000;
/** Shorter poll while uploads are pending (does not change delivery RPC sequence). */
export const PENDING_QUEUE_ACTIVE_RETRY_MS = 1500;
export const PENDING_QUEUE_FAST_RETRY_WINDOW_MS = 10 * 60 * 1000;

let _pendingUploadWakeTimer = null;
let _pendingUploadWakePromise = null;

/** Debounced queue flush after enqueue/update — faster pending→completed when online. */
export function schedulePendingUploadSync(options = {}) {
  if (_pendingUploadWakeTimer) clearTimeout(_pendingUploadWakeTimer);
  const delayMs = options.immediate === true ? 0 : 80;
  _pendingUploadWakeTimer = setTimeout(() => {
    _pendingUploadWakeTimer = null;
    if (_pendingUploadWakePromise) {
      _pendingUploadWakePromise.finally(() => schedulePendingUploadSync(options));
      return;
    }
    _pendingUploadWakePromise = flushPendingUploadsNow({
      includeAttachments: options.includeAttachments !== false,
      queuePasses: options.queuePasses ?? 12,
      aggressive: options.immediate === true || options.aggressive === true,
    })
      .then(async (result) => {
        if ((result?.pendingCount ?? 1) === 0) {
          try {
            if (_syncCompleteListener) _syncCompleteListener(true);
          } catch (_) {
            /* non-fatal */
          }
        }
      })
      .finally(() => {
      _pendingUploadWakePromise = null;
    });
  }, delayMs);
}

/** Dashboard counters (red / orange) — set from DashboardScreen only; used to skip idle fast-sync. */
let _dashboardUploadIndicators = { pendingOrders: 0, localCompleted: 0 };
export function setDashboardUploadIndicators(pendingOrders, localCompleted) {
  _dashboardUploadIndicators = {
    pendingOrders: Math.max(0, Number(pendingOrders) || 0),
    localCompleted: Math.max(0, Number(localCompleted) || 0),
  };
}
export function hasDashboardUploadIndicators() {
  return (
    _dashboardUploadIndicators.pendingOrders > 0 || _dashboardUploadIndicators.localCompleted > 0
  );
}

/** True when queue or offline proof photos still need uploading. */
export async function hasPendingUploadWork() {
  try {
    const pending = await syncQueueDb.getPendingCount();
    if (pending > 0) return true;
    const offlineAttachmentsDb = await import('../database/offlineAttachments.js');
    const rows = await offlineAttachmentsDb.getAllPending();
    return (rows || []).length > 0;
  } catch (_) {
    return false;
  }
}
const KEYS = {
  USER: '@gastech_user',
  USER_MEDIA: '@gastech_user_media',
  LAST_SYNC: '@gastech_last_sync',
  LAST_VEHICLE_ID: '@gastech_last_vehicle_id',
  SYNC_PERIOD: '@gastech_sync_period',
  SYNC_DATE_FIELD: '@gastech_sync_date_field',
  SYNC_INTERVAL: '@gastech_sync_interval',
};

const KEY_POST_LOGIN_SYNC_OK = '@gastech_post_login_sync_ok';
/** Persists the one-time dashboard "initial load" gate across process restarts (per driver+vehicle session key). */
const KEY_DASHBOARD_INITIAL_LOAD = '@gastech_dash_init_load_v1';
const TRANSLATION_STORAGE_KEYS = ['@gastech_translations', '@gastech_translations_version'];

let _dashboardInitialLoadMemoryDone = false;

function sessionKeyForDashboardInitialLoad(u) {
  if (!u || typeof u !== 'object') return null;
  if (u.isAdmin) {
    return u.vehicleId != null ? `admin|${Number(u.vehicleId)}` : 'admin';
  }
  const d = u.driverId;
  const v = u.vehicleId;
  if (d == null && v == null) return null;
  return `${Number(d) || 0}|${Number(v) || 0}`;
}

/** In-memory: same as persisted flag, for the current app process (avoids a loader flash on tab remounts). */
export function isDashboardInitialLoadMemoryDone() {
  return _dashboardInitialLoadMemoryDone;
}

/**
 * If AsyncStorage has a completed initial dashboard load for the current session, sets memory and returns true.
 * Call on Dashboard mount so the full-screen gate does not repeat after app restart.
 */
export async function hydrateDashboardInitialLoadFromStorage() {
  try {
    const u = await getUserSession();
    const want = sessionKeyForDashboardInitialLoad(u);
    if (!want) return { done: false };
    const storage = await getAsyncStorage();
    const raw = await storage.getItem(KEY_DASHBOARD_INITIAL_LOAD);
    if (raw === want) {
      _dashboardInitialLoadMemoryDone = true;
      return { done: true };
    }
  } catch (_) { }
  return { done: false };
}

/** Mark initial dashboard load complete (memory + storage for current user session). */
export async function markDashboardInitialLoadComplete(userSnapshot) {
  try {
    const u = userSnapshot && typeof userSnapshot === 'object' ? userSnapshot : await getUserSession();
    const want = sessionKeyForDashboardInitialLoad(u);
    if (!want) return;
    const storage = await getAsyncStorage();
    await storage.setItem(KEY_DASHBOARD_INITIAL_LOAD, want);
    _dashboardInitialLoadMemoryDone = true;
  } catch (_) { }
}

function resetDashboardInitialLoadState() {
  _dashboardInitialLoadMemoryDone = false;
}

/** After a successful login sync, Dashboard shows a one-time success dialog. */
export async function setPostLoginSyncSuccessPending() {
  const storage = await getAsyncStorage();
  await storage.setItem(KEY_POST_LOGIN_SYNC_OK, '1');
}

export async function consumePostLoginSyncSuccessPending() {
  const storage = await getAsyncStorage();
  const v = await storage.getItem(KEY_POST_LOGIN_SYNC_OK);
  if (v === '1') {
    await storage.removeItem(KEY_POST_LOGIN_SYNC_OK);
    return true;
  }
  return false;
}

const SYNC_INTERVAL_MAP = {
  '1min': 1 * 60 * 1000,
  '5min': 5 * 60 * 1000,
  '10min': 10 * 60 * 1000,
  '30min': 30 * 60 * 1000,
  '1hour': 60 * 60 * 1000,
  '2hour': 2 * 60 * 60 * 1000,
};

const LOG_TAG = '[Sync]';

function log(step, detail = '') {
  const msg = detail ? `${LOG_TAG} ${step} — ${detail}` : `${LOG_TAG} ${step}`;
  console.log(msg);
}

function logWarn(step, err) {
  console.warn(`${LOG_TAG} ${step}`, err?.message ?? err);
}

let _asyncStorage;
async function getAsyncStorage() {
  if (!_asyncStorage) _asyncStorage = (await import('@react-native-async-storage/async-storage')).default;
  return _asyncStorage;
}
/** In-flight sync runner; concurrent callers await the same promise. */
let _runSyncPromise = null;

function sanitizeUserSessionForStorage(user) {
  const src = user && typeof user === 'object' ? user : {};
  const out = { ...src };
  if (typeof out.driverImageBase64 === 'string' && out.driverImageBase64.length > 0) {
    out.driverImageBase64 = null;
  }
  if (Array.isArray(out.selectedPorters)) {
    out.selectedPorters = out.selectedPorters.map((p) => {
      if (!p || typeof p !== 'object') return p;
      const clone = { ...p };
      if (typeof clone.imageBase64 === 'string' && clone.imageBase64.length > 0) {
        clone.imageBase64 = null;
      }
      return clone;
    });
  }
  return out;
}

function extractUserSessionMedia(user) {
  const src = user && typeof user === 'object' ? user : {};
  return {
    driverImageBase64: typeof src.driverImageBase64 === 'string' ? src.driverImageBase64 : null,
    selectedPorters: Array.isArray(src.selectedPorters)
      ? src.selectedPorters
        .map((p) => {
          if (!p || typeof p !== 'object') return null;
          return {
            id: p.id ?? null,
            imageBase64: typeof p.imageBase64 === 'string' ? p.imageBase64 : null,
          };
        })
        .filter((p) => p != null)
      : [],
  };
}

export async function getUserSession() {
  try {
    const storage = await getAsyncStorage();
    const [raw, rawMedia] = await Promise.all([
      storage.getItem(KEYS.USER),
      storage.getItem(KEYS.USER_MEDIA),
    ]);
    if (!raw) return null;
    const user = JSON.parse(raw);
    if (rawMedia) {
      try {
        const media = JSON.parse(rawMedia);
        if (media && typeof media === 'object') {
          if (typeof media.driverImageBase64 === 'string' && media.driverImageBase64.length > 0) {
            user.driverImageBase64 = media.driverImageBase64;
          }
          if (Array.isArray(media.selectedPorters) && Array.isArray(user.selectedPorters)) {
            const mediaById = new Map(
              media.selectedPorters
                .filter((p) => p && p.id != null)
                .map((p) => [String(p.id), p])
            );
            user.selectedPorters = user.selectedPorters.map((porter) => {
              const mediaPorter = mediaById.get(String(porter?.id));
              if (mediaPorter?.imageBase64) {
                return { ...porter, imageBase64: mediaPorter.imageBase64 };
              }
              return porter;
            });
          }
        }
      } catch (_) {
        /* ignore media merge issues */
      }
    }
    return user;
  } catch (e) {
    console.warn(`${LOG_TAG} getUserSession parse/read failed`, e?.message ?? e);
    return null;
  }
}

export async function saveUserSession(user) {
  const storage = await getAsyncStorage();
  const safeUser = sanitizeUserSessionForStorage(user);
  const mediaPayload = JSON.stringify(extractUserSessionMedia(user));
  try {
    await storage.multiSet([
      [KEYS.USER, JSON.stringify(safeUser)],
      [KEYS.USER_MEDIA, mediaPayload],
    ]);
  } catch (e) {
    // On some devices AsyncStorage may fail when media payload is large.
    // Keep login reliable by storing core session first, then try media best-effort.
    // Never overwrite existing media with empty placeholders, otherwise profile images disappear.
    console.warn(`${LOG_TAG} saveUserSession media payload fallback`, e?.message ?? e);
    await storage.setItem(KEYS.USER, JSON.stringify(safeUser));
    try {
      await storage.setItem(KEYS.USER_MEDIA, mediaPayload);
    } catch (_) {
      // ignore media storage fallback errors; core session is already saved.
      // keep previously stored USER_MEDIA intact in this case.
    }
  }
}

/** Next local midnight (12:00 AM) as ISO string — session is valid until then. */
export function getSessionExpiryAtIsoEndOfLocalDay() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/** True when session should end (daily auto logout at local midnight). */
export function isSessionExpired(user) {
  if (!user || !user.sessionExpiresAt) return false;
  const t = Date.parse(user.sessionExpiresAt);
  if (Number.isNaN(t)) return false;
  return Date.now() >= t;
}

export async function saveLastVehicleId(vehicleId) {
  try {
    const storage = await getAsyncStorage();
    await storage.setItem(KEYS.LAST_VEHICLE_ID, String(vehicleId));
  } catch (_) { }
}

export async function getLastVehicleId() {
  try {
    const storage = await getAsyncStorage();
    const raw = await storage.getItem(KEYS.LAST_VEHICLE_ID);
    return raw != null && raw !== '' ? raw : null;
  } catch {
    return null;
  }
}

export async function logout() {
  resetDashboardInitialLoadState();
  const storage = await getAsyncStorage();
  await storage.multiRemove([KEYS.USER, KEYS.USER_MEDIA, KEYS.LAST_SYNC, KEY_DASHBOARD_INITIAL_LOAD]);
}

// ---------- Local reads (from SQLite) ----------

export async function getCachedCustomers() {
  try {
    return await partnersDb.getAllPartners();
  } catch (e) {
    console.warn('getCachedCustomers', e);
    return [];
  }
}
export async function getFilteredCustomers(vehicleId) {
  try {
    return await partnersDb.getCustomersByVehicle(vehicleId);
  } catch (e) {
    console.warn('getFilteredCustomers error:', e);
    return [];
  }
}
/**
 * @param {number | null} [vehicleId] - When set (vehicle login), return only orders for this vehicle.
 */
export async function getCachedOrders(vehicleId = null) {
  try {
    const storage = await getAsyncStorage();
    const syncDateField = await storage.getItem(KEYS.SYNC_DATE_FIELD);
    const sortField = syncDateField === 'delivery_date' ? 'commitment_date' : 'date_order';
    const rows = await saleOrdersDb.getAllSaleOrders(vehicleId, sortField);
    // Keep cancelled orders hidden across the app by default.
    return (rows || []).filter((o) => String(o?.state || '').toLowerCase() !== 'cancel');
  } catch (e) {
    console.warn('getCachedOrders', e);
    return [];
  }
}

export async function getCachedVehicles() {
  try {
    return await vehiclesDb.getAllVehicles();
  } catch (e) {
    console.warn('getCachedVehicles', e);
    return [];
  }
}

export async function getCachedVehicleInventory(vehicleId) {
  try {
    return await vehicleInventoriesDb.getVehicleInventoryByVehicleId(vehicleId);
  } catch (e) {
    console.warn('getCachedVehicleInventory', e);
    return [];
  }
}

/**
 * Get the location_id (stock.location id) for a given vehicle from local DB.
 * @param {number} vehicleId
 * @returns {Promise<number|null>}
 */
export async function getVehicleLocationId(vehicleId) {
  try {
    const warehouse = await vehicleWarehousesDb.getVehicleWarehouseByVehicleId(vehicleId);
    return warehouse?.id ?? null;
  } catch (e) {
    console.warn('getVehicleLocationId', e);
    return null;
  }
}

/**
 * Get cached vehicle inventory by location_id from local DB.
 * @param {number} locationId
 * @returns {Promise<Array>}
 */
export async function getCachedVehicleInventoryByLocation(locationId) {
  try {
    return await vehicleInventoriesDb.getVehicleInventoryByLocationId(locationId);
  } catch (e) {
    console.warn('getCachedVehicleInventoryByLocation', e);
    return [];
  }
}

export async function getCachedRoutes() {
  try {
    return await routesDb.getAllRoutes();
  } catch (e) {
    console.warn('getCachedRoutes', e);
    return [];
  }
}

/** Sale order details from local DB (order + lines). Same shape as API. Lines loaded by order_id so they appear even if order_line was empty on sync. */
export async function getSaleOrderDetailsFromDB(saleOrderId) {
  try {
    const soId = Number(saleOrderId);
    const order = await saleOrdersDb.getSaleOrderById(soId);
    const lines = await saleOrderLinesDb.getSaleOrderLinesByOrderIds([soId]);
    return { order, lines: lines || [] };
  } catch (e) {
    console.warn('getSaleOrderDetailsFromDB', e);
    return { order: null, lines: [] };
  }
}

/** Delivery data from local DB: picking, moves, moveLines for a sale order. Prefers first picking not yet done (avoids using an old completed transfer when a backorder exists). */
export async function getDeliveryDataFromDB(saleOrderId) {
  try {
    const pickings = await stockPickingsDb.getStockPickingsBySaleId(Number(saleOrderId));
    const list = pickings || [];
    const open = list.filter((p) => String(p.state || '').toLowerCase() !== 'done');
    const picking = open[0] ?? list[0] ?? null;
    if (!picking?.id) return { picking: null, moves: [], moveLines: [] };
    /** Always resolve move IDs from `stock_moves` for this picking — never trust `picking.move_ids` alone (wrong ids break move_line lookup). */
    const moves = await stockMovesDb.getStockMovesByPickingId(picking.id);
    const moveIdsFromMoves = (moves || []).map((m) => m.id).filter((id) => id != null);
    const moveLines =
      moveIdsFromMoves.length > 0
        ? await stockMoveLinesDb.getStockMoveLinesByMoveIds(moveIdsFromMoves)
        : [];
    return { picking, moves: moves || [], moveLines: moveLines || [] };
  } catch (e) {
    console.warn('getDeliveryDataFromDB', e);
    return { picking: null, moves: [], moveLines: [] };
  }
}

/** Pickings by sale ids from DB (for list/delivered badge). */
export async function getPickingsBySaleIdsFromDB(saleOrderIds) {
  if (!saleOrderIds?.length) return [];
  try {
    return await stockPickingsDb.getStockPickingsBySaleIds(saleOrderIds);
  } catch (e) {
    console.warn('getPickingsBySaleIdsFromDB', e);
    return [];
  }
}

/** Order line totals by order id from DB. Returns { orderId: totalQty }. */
export async function getOrderLineTotalsFromDB(orders) {
  if (!orders?.length) return {};
  const orderIds = orders.map((o) => o.id);
  try {
    const lines = await saleOrderLinesDb.getSaleOrderLinesByOrderIds(orderIds);
    const byOrder = {};
    lines.forEach((line) => {
      const orderId = Array.isArray(line.order_id) ? line.order_id[0] : line.order_id;
      const qty = Number(line.product_uom_qty) || 0;
      byOrder[orderId] = (byOrder[orderId] || 0) + qty;
    });
    return byOrder;
  } catch (e) {
    console.warn('getOrderLineTotalsFromDB', e);
    return {};
  }
}

/** Order lines by order id from DB (for list item-wise badges). Returns flat array; group by order_id in caller. */
export async function getOrderLinesByOrderIdsFromDB(orderIds) {
  if (!orderIds?.length) return [];
  try {
    return await saleOrderLinesDb.getSaleOrderLinesByOrderIds(orderIds);
  } catch (e) {
    console.warn('getOrderLinesByOrderIdsFromDB', e);
    return [];
  }
}

export async function getLastSyncTime() {
  try {
    const fromLog = await syncLogDb.getLastSyncTime();
    if (fromLog != null && fromLog !== '') return fromLog;
    const storage = await getAsyncStorage();
    const fromStorage = await storage.getItem(KEYS.LAST_SYNC);
    return fromStorage || null;
  } catch {
    return null;
  }
}

export async function getSyncLogRecent(limit = 20) {
  try {
    return await syncLogDb.getRecent(limit);
  } catch {
    return [];
  }
}

/** Journals from local DB (for offline payment screen). */
export async function getCachedJournals() {
  try {
    return await journalsDb.getAllJournals();
  } catch (e) {
    console.warn('getCachedJournals', e);
    return [];
  }
}

/**
 * Get journal details by id from map (handles number/string keys).
 */
function getJournalDetails(detailsMap, id) {
  if (id == null || !detailsMap || typeof detailsMap !== 'object') return null;
  return detailsMap[id] ?? detailsMap[Number(id)] ?? detailsMap[String(id)] ?? null;
}

/**
 * Classify payment type by journal name (Delivery tab + Dashboard).
 * Step 3 of flow: Get payment → journal_id → classify by journal name.
 * - Cash: journal name is exactly "Cash" OR starts with "Cash_" (e.g. Cash_LN-0309, Cash_LN-0417).
 * - Cheque: journal name is exactly "Cheque" OR starts with "CHQ_" (e.g. CHQ_LN-0423, CHQ_LN-0417).
 * - Otherwise (unknown journal or no journal): return null → order treated as Credit.
 * When Odoo returns only id, uses detailsMap (from getJournalDetailsByIds) to resolve name.
 * @param {number| [number, string]} journalId - from Odoo (id or [id, name])
 * @param {{ [id: number]: string }} [codeMap] - id -> code (fallback)
 * @param {{ [id: number]: { name: string, code: string } }} [detailsMap] - id -> { name, code } from getJournalDetailsByIds
 * @returns {'cash'|'cheque'|null} - null means treat as Credit
 */
function paymentTypeFromJournal(journalId, codeMap = {}, detailsMap = {}) {
  const id = Array.isArray(journalId) ? journalId[0] : journalId;
  let jName = Array.isArray(journalId) ? (journalId[1] || '') : '';
  if (!jName && id != null) {
    const details = getJournalDetails(detailsMap, id);
    jName = (details && details.name) ? details.name : '';
  }
  if (!jName) jName = String(journalId ?? '');
  const nameTrimmed = (jName || '').toString().trim();
  const nameLower = nameTrimmed.toLowerCase();
  // Cash: exactly "Cash" or starts with "Cash_" (e.g. Cash_LN-0309)
  if (nameLower === 'cash' || nameLower.startsWith('cash_')) return 'cash';
  // Cheque: exactly "Cheque" or starts with "CHQ_" (e.g. CHQ_LN-0423)
  if (nameLower === 'cheque' || nameLower.startsWith('chq_')) return 'cheque';
  // Fallback: code (default journals CSH1/CSH2; vehicle codes CSHL*, CHQL*)
  const details = id != null ? getJournalDetails(detailsMap, id) : null;
  const code = (details && details.code ? details.code : (codeMap && id != null ? (codeMap[id] ?? codeMap[Number(id)] ?? codeMap[String(id)]) : '')).toString().toUpperCase().trim();
  if (code === 'CSH2' || code.startsWith('CHQL')) return 'cheque';
  if (code === 'CSH1' || code.startsWith('CSHL')) return 'cash';
  // Broader name hints (custom / localized Odoo journals)
  if (nameLower.includes('cheque') || nameLower.includes('checkbook') || /\bchk\b/.test(nameLower)) return 'cheque';
  if (nameLower.includes('cash') || nameLower.includes('counter') || nameLower.includes('petty')) return 'cash';
  // Unknown journal: caller may fold amount into cash for paid invoices (cross-device parity)
  return null;
}

/**
 * Refresh payment_type from Odoo so Delivery tab and Dashboard show correct Cash/Cheque/Credit.
 * Flow (aligns with backend payment journal):
 *   Step 1: Get invoice for sale order via account.move search_read [["invoice_origin", "in", orderNames]].
 *   Step 2: Get payments for invoice via account.payment search_read [["reconciled_invoice_ids", "in", [invoiceId]]]; fields include amount, journal_id.
 *   Step 3: Classify by journal name: Cash/Cash_* → cash, Cheque/CHQ_* → cheque; no payment or unknown journal → credit.
 * @param {Array<{ id?: number, name?: string, invoice_status?: string }>} syncedOrders - orders just synced from Odoo
 * @param {{ skipOrderIds?: Set<number> }} [options] - When set, do not overwrite payment_type for these order ids (e.g. orders with pending upload).
 */
export async function refreshPaymentTypesFromOdoo(syncedOrders, options = {}) {
  const skipOrderIds = options.skipOrderIds;
  // Case-insensitive: Odoo may return "Invoiced" or "invoiced"
  const orderNames = (syncedOrders || [])
    .filter((o) => String(o.invoice_status || '').toLowerCase() === 'invoiced' && o.name)
    .map((o) => String(o.name).trim());
  if (orderNames.length === 0) return;
  const orderNameToId = {};
  (syncedOrders || []).forEach((o) => {
    if (o.name && o.id != null) orderNameToId[String(o.name).trim()] = o.id;
  });
  try {
    const {
      getInvoicesForPaymentRefresh,
      getPaymentsByInvoiceIds,
      updateInvoiceIncotermLocation,
    } = await import('./invoice.service');
    const localInvoicesDb = await import('../database/localInvoices.js');
    const saleOrderIds = (syncedOrders || [])
      .filter((o) => String(o.invoice_status || '').toLowerCase() === 'invoiced' && o.id != null)
      .map((o) => Number(o.id))
      .filter((id) => Number.isFinite(id) && id > 0);
    // Step 1: Invoices by invoice_origin plus sale.order.invoice_ids (covers origin mismatch on a fresh device)
    const invoices = await getInvoicesForPaymentRefresh(orderNames, saleOrderIds);
    if (!invoices?.length) {
      log('refresh', 'no invoices returned from Odoo for invoiced orders');
      return;
    }

    // Send locally generated invoice number to backend (incoterm_location) for every invoice that has a local record.
    for (const inv of invoices) {
      const origin = inv.invoice_origin != null ? String(inv.invoice_origin).trim() : '';
      if (!origin) continue;
      const localOrderId = orderNameToId[origin];
      if (localOrderId == null) continue;
      try {
        const localInv = await localInvoicesDb.getLocalInvoiceBySaleOrderId(localOrderId);
        if (localInv && localInv.invoice_number) {
          await updateInvoiceIncotermLocation(inv.id, localInv.invoice_number);
          await localInvoicesDb.updateLocalInvoiceSynced(localInv.id, inv.id);
          log('refresh', `incoterm_location set for invoice ${inv.id} (origin=${origin}) -> ${localInv.invoice_number}`);
        }
      } catch (e) {
        logWarn('update incoterm_location from local invoice', e);
      }
    }

    // Use ALL invoice ids to fetch payments (do not rely on payment_state – API may only return id, name, state)
    const allInvoiceIds = invoices.map((inv) => inv.id).filter((id) => id != null);
    log('refresh', `invoices=${invoices.length} ids=${allInvoiceIds.length}`);
    const orderNameToSplit = {};

    // Step 2: Get payments by invoice IDs: [["reconciled_invoice_ids", "in", [170, ...]]]; can return multiple per invoice (cash + cheque).
    if (allInvoiceIds.length === 0) {
      invoices.forEach((inv) => {
        const origin = inv.invoice_origin != null ? String(inv.invoice_origin).trim() : '';
        const total = Number(inv.amount_total) || 0;
        if (origin) orderNameToSplit[origin] = { cash: 0, cheque: 0, credit: total };
      });
    } else {
      const payments = await getPaymentsByInvoiceIds(allInvoiceIds);
      log('refresh', `payments from Odoo=${(payments || []).length}`);
      const journalIds = (payments || [])
        .map((pm) => (Array.isArray(pm.journal_id) ? pm.journal_id[0] : pm.journal_id))
        .filter((jid) => jid != null);
      const { getJournalDetailsByIds } = await import('./journal.service.js');
      const journalDetailsMap = journalIds.length > 0 ? await getJournalDetailsByIds(journalIds) : {};
      const invoiceIdToPayments = {};
      for (const pm of payments || []) {
        const invIds = Array.isArray(pm.reconciled_invoice_ids) ? pm.reconciled_invoice_ids : [];
        invIds.forEach((id) => {
          const invId = Array.isArray(id) ? id[0] : id;
          if (invId == null) return;
          if (!invoiceIdToPayments[invId]) invoiceIdToPayments[invId] = [];
          invoiceIdToPayments[invId].push(pm);
        });
      }
      // Step 3: Per invoice, sum cash/cheque by journal; remainder (total - paid) = credit
      for (const inv of invoices) {
        const origin = inv.invoice_origin != null ? String(inv.invoice_origin).trim() : '';
        if (!origin) continue;
        const invTotal = Number(inv.amount_total) || 0;
        const pms = invoiceIdToPayments[inv.id] || [];
        let cashSum = 0;
        let chequeSum = 0;
        let otherSum = 0;
        for (const pm of pms) {
          const amt = Number(pm.amount) || 0;
          const type = paymentTypeFromJournal(pm.journal_id, {}, journalDetailsMap);
          if (type === 'cash') cashSum += amt;
          else if (type === 'cheque') chequeSum += amt;
          else otherSum += amt;
        }
        if (pms.length === 0) {
          const ps = String(inv.payment_state || '').toLowerCase();
          if (ps === 'paid') {
            orderNameToSplit[origin] = { cash: invTotal, cheque: 0, credit: 0 };
            continue;
          }
        } else if (otherSum > 0) {
          cashSum += otherSum;
        }
        const paid = cashSum + chequeSum;
        const creditAmount = Math.max(0, invTotal - paid);
        orderNameToSplit[origin] = { cash: cashSum, cheque: chequeSum, credit: creditAmount };
      }
    }

    // Do not write placeholder {0,0,0} splits — that forces "Credit" in the UI when Odoo data was incomplete

    // Primary type for tab: whichever has max amount (tie: cheque > cash > credit)
    function primaryTypeFromSplit(split) {
      const c = Number(split?.cash) || 0;
      const q = Number(split?.cheque) || 0;
      const r = Number(split?.credit) || 0;
      const max = Math.max(c, q, r);
      if (max === 0) return 'credit';
      if (q === max) return 'cheque';
      if (c === max) return 'cash';
      return 'credit';
    }

    let updated = 0;
    let byCash = 0;
    let byCheque = 0;
    let byCredit = 0;
    for (const name of Object.keys(orderNameToSplit)) {
      const trimmedName = String(name).trim();
      const orderId = orderNameToId[trimmedName] ?? orderNameToId[name];
      const split = orderNameToSplit[name];
      const paymentType = primaryTypeFromSplit(split);
      if (paymentType === 'cash') byCash++;
      else if (paymentType === 'cheque') byCheque++;
      else byCredit++;
      if (skipOrderIds?.size && orderId != null && skipOrderIds.has(Number(orderId))) continue;
      if (orderId != null) {
        await saleOrdersDb.updatePaymentSplitByOrderId(orderId, split, paymentType);
      } else {
        await saleOrdersDb.updatePaymentSplitByOrderName(trimmedName, split, paymentType);
      }
      updated++;
    }
    log('refresh', `payment_type: ${updated} updated (cash=${byCash} cheque=${byCheque} credit=${byCredit}) from Odoo invoice+payment APIs`);
  } catch (e) {
    logWarn('refresh payment_type from Odoo', e);
  }
}

/**
 * Fetch Cash/Cheque/Credit totals from Odoo for given order names (e.g. today's delivered).
 * Flow: (1) Invoiced orders only (invoices by invoice_origin). (2) If not paid (payment_state !== 'paid', e.g. in_payment) → add to creditTotal. (3) If paid → get payments by reconciled_invoice_ids; by journal (Cash vs Cheque) add amount to cashTotal or chequeTotal. Returns actual values for Dashboard.
 */
export async function getCollectionTotalsFromOdoo(orderNames) {
  if (!Array.isArray(orderNames) || orderNames.length === 0) {
    return { cashTotal: 0, chequeTotal: 0, creditTotal: 0 };
  }
  try {
    const {
      getInvoicesForPaymentRefresh,
      getPaymentsByInvoiceIds,
      searchSaleOrderIdsByNames,
    } = await import('./invoice.service');
    const soIds = await searchSaleOrderIdsByNames(orderNames);
    const invoices = await getInvoicesForPaymentRefresh(orderNames, soIds);
    if (!invoices?.length) return { cashTotal: 0, chequeTotal: 0, creditTotal: 0 };

    let cashTotal = 0;
    let chequeTotal = 0;
    let creditTotal = 0;
    const paidInvoiceIds = [];
    const paidAmountByInvoiceId = {};

    for (const inv of invoices) {
      const state = (inv.payment_state || '').toLowerCase();
      const amount = Number(inv.amount_total) || 0;
      if (state === 'paid') {
        paidInvoiceIds.push(inv.id);
        paidAmountByInvoiceId[inv.id] = amount;
      } else {
        creditTotal += amount;
      }
    }

    if (paidInvoiceIds.length > 0) {
      const payments = await getPaymentsByInvoiceIds(paidInvoiceIds);
      const journalIds = (payments || [])
        .map((pm) => (Array.isArray(pm.journal_id) ? pm.journal_id[0] : pm.journal_id))
        .filter((jid) => jid != null);
      const { getJournalDetailsByIds } = await import('./journal.service.js');
      const journalDetailsMap = journalIds.length > 0 ? await getJournalDetailsByIds(journalIds) : {};
      const invoiceIdToPayments = {};
      for (const pm of payments || []) {
        const invIds = Array.isArray(pm.reconciled_invoice_ids) ? pm.reconciled_invoice_ids : [];
        invIds.forEach((id) => {
          const invId = Array.isArray(id) ? id[0] : id;
          if (invId == null) return;
          if (!invoiceIdToPayments[invId]) invoiceIdToPayments[invId] = [];
          invoiceIdToPayments[invId].push(pm);
        });
      }
      for (const invId of paidInvoiceIds) {
        const invTotal = paidAmountByInvoiceId[invId] || 0;
        const pms = invoiceIdToPayments[invId] || [];
        if (pms.length === 0) {
          cashTotal += invTotal;
          continue;
        }
        let c = 0;
        let q = 0;
        let o = 0;
        for (const pm of pms) {
          const amt = Number(pm.amount) || 0;
          const type = paymentTypeFromJournal(pm.journal_id, {}, journalDetailsMap);
          if (type === 'cash') c += amt;
          else if (type === 'cheque') q += amt;
          else o += amt;
        }
        if (o > 0) c += o;
        cashTotal += c;
        chequeTotal += q;
      }
    }

    return { cashTotal, chequeTotal, creditTotal };
  } catch (e) {
    console.warn('getCollectionTotalsFromOdoo', e);
    return null;
  }
}

/**
 * Writes Odoo sale.order custom fields: driver_employee_id (many2one), porter_employee_ids (many2many).
 * Values come from the payment queue payload (set at checkout); falls back to current session if missing.
 */
async function writeSaleOrderCrewFromPaymentPayload(soId, payload) {
  const p = payload || {};
  let driverId = null;
  const dRaw = p.driverEmployeeId ?? p.driver_employee_id;
  if (dRaw != null && Number.isFinite(Number(dRaw))) {
    const n = Number(dRaw);
    if (n > 0) driverId = n;
  }

  let porterIds = [];
  const pr = p.porterEmployeeIds ?? p.porter_employee_ids;
  if (Array.isArray(pr)) {
    porterIds = pr.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0);
  }

  if (driverId == null || porterIds.length === 0) {
    try {
      const session = await getUserSession();
      if (driverId == null && session?.driverId != null) {
        const n = Number(session.driverId);
        if (Number.isFinite(n) && n > 0) driverId = n;
      }
      if (porterIds.length === 0 && Array.isArray(session?.selectedPorters)) {
        porterIds = session.selectedPorters
          .map((x) => Number(x?.id))
          .filter((n) => Number.isFinite(n) && n > 0);
      }
    } catch (_) { }
  }

  if (driverId == null && porterIds.length === 0) return;

  const vals = {};
  if (driverId != null) vals.driver_employee_id = driverId;
  /** Never use [[6,0,[]]] — that would clear all porters in Odoo. */
  if (porterIds.length > 0) vals.porter_employee_ids = [[6, 0, porterIds]];

  try {
    const { callOdooArgs } = await import('./index.service.js');
    await callOdooArgs('sale.order', 'write', [[soId], vals]);
    log(
      'queue',
      `SO ${soId}: sale.order crew — driver_employee_id=${driverId ?? '—'}, porters=${porterIds.length}`
    );
  } catch (e) {
    const short = (e?.message || String(e)).slice(0, 280);
    logWarn(
      'sale.order crew fields (driver_employee_id / porter_employee_ids)',
      new Error(short || 'write failed')
    );
  }
}

function isUnknownFieldOdooReadError(err) {
  const m = String(err?.message || err || '').toLowerCase();
  return (
    m.includes('field') &&
    (m.includes('invalid') || m.includes('unknown') || m.includes('does not exist') || m.includes('undefined'))
  );
}

/** Re-read `invoice_status` / `invoice_number` from Odoo so SQLite matches the server after payment + invoice. */
async function pullSaleOrderHeaderAfterPayment(saleOrderId) {
  try {
    const { callOdoo } = await import('./index.service.js');
    const id = Number(saleOrderId);
    if (!Number.isFinite(id) || id <= 0) return;
    let rows;
    try {
      rows = await callOdoo('sale.order', 'read', [[id]], {
        fields: ['invoice_status', 'invoice_number'],
      });
    } catch (e1) {
      if (!isUnknownFieldOdooReadError(e1)) throw e1;
      rows = await callOdoo('sale.order', 'read', [[id]], { fields: ['invoice_status'] });
    }
    const r = Array.isArray(rows) ? rows[0] : null;
    if (!r) return;
    const patch = {};
    if (r.invoice_status != null && r.invoice_status !== false) {
      patch.invoice_status = r.invoice_status;
    }
    if (r.invoice_number != null && r.invoice_number !== false) {
      const s = String(r.invoice_number).trim();
      if (s) patch.invoice_number = s;
    }
    if (Object.keys(patch).length === 0) return;
    await saleOrdersDb.patchSaleOrderHeaderFromOdoo(id, patch);
  } catch (e) {
    logWarn('pullSaleOrderHeaderAfterPayment', e);
  }
}

/** Re-read sale.order invoice header from Odoo into SQLite (e.g. after payment sync or Delivered tab load). */
export async function refreshSaleOrderInvoiceHeaderFromOdoo(saleOrderId) {
  return pullSaleOrderHeaderAfterPayment(saleOrderId);
}

const DELIVERED_QTY_VERIFY_TOL = 0.02;

function roundDeliveredQty3(q) {
  return Math.round(Number(q) * 1000) / 1000;
}

/** Merge delivered-qty rows; later entries win (queue payload overrides mobile SQLite during sync). */
function mergeDeliveredQtyUpdates(...lists) {
  const map = new Map();
  for (const list of lists) {
    for (const u of list || []) {
      const lid = Number(u?.lineId);
      const q = roundDeliveredQty3(u?.qty_delivered);
      if (!Number.isFinite(lid) || lid <= 0 || u?.qty_delivered == null || !Number.isFinite(q)) continue;
      map.set(lid, q);
    }
  }
  return Array.from(map.entries()).map(([lineId, qty_delivered]) => ({ lineId, qty_delivered }));
}

function invoiceLineQtysToDeliveredUpdates(invoiceLineQtys) {
  if (!Array.isArray(invoiceLineQtys)) return [];
  return invoiceLineQtys
    .map((row) => ({
      lineId: Number(row?.lineId),
      qty_delivered: roundDeliveredQty3(row?.qty),
    }))
    .filter((u) => Number.isFinite(u.lineId) && u.lineId > 0 && Number.isFinite(u.qty_delivered));
}

/** Driver truth on device after checkout — used to heal rare Odoo/mobile qty drift. */
async function getMobileDeliveredUpdatesForSaleOrder(saleOrderId) {
  const soId = Number(saleOrderId);
  if (!Number.isFinite(soId) || soId <= 0) return [];
  const lines = await saleOrderLinesDb.getSaleOrderLinesByOrderIds([soId]).catch(() => []);
  const updates = [];
  for (const l of lines || []) {
    const lid = Number(l?.id);
    const qd = roundDeliveredQty3(l?.qty_delivered);
    if (!Number.isFinite(lid) || lid <= 0 || !Number.isFinite(qd) || qd <= 0) continue;
    updates.push({ lineId: lid, qty_delivered: qd });
  }
  return updates;
}

async function collectAuthoritativeDeliveredUpdates(saleOrderId, queuePayload = null) {
  const snap = await resolveDeliveredSnapshotForSync(saleOrderId, queuePayload);
  return snap.updates || [];
}

/** Delivered qty rows for Odoo writes: frozen checkout snapshot (invoiceLineQtys wins over stale SOL rows). */
function deliveredUpdatesFromQueuePayload(queuePayload) {
  const p = queuePayload || {};
  return mergeDeliveredQtyUpdates(
    invoiceLineQtysToDeliveredUpdates(p.invoiceLineQtys),
    p.saleOrderLineDeliveredUpdates || []
  );
}

/**
 * Mobile-confirmed qty for Odoo: delivery queue row + payment invoiceLineQtys (same values driver entered).
 */
async function resolveDeliveredSnapshotForSync(saleOrderId, deliveryPayload) {
  const soId = Number(saleOrderId);
  let merged = { ...(deliveryPayload || {}) };
  if (Number.isFinite(soId) && soId > 0) {
    try {
      const pay = await syncQueueDb.getPendingPaymentItemBySaleOrderId(soId);
      const inv = pay?.payload?.invoiceLineQtys;
      if (Array.isArray(inv) && inv.length > 0) {
        merged = { ...merged, invoiceLineQtys: inv };
      }
    } catch (_) {
      /* non-fatal */
    }
  }
  const updates = deliveredUpdatesFromQueuePayload(merged);
  if (updates.length > 0) return { payload: merged, updates };
  const mobile = await getMobileDeliveredUpdatesForSaleOrder(soId);
  return { payload: merged, updates: mobile };
}

async function verifyAllSaleOrderPickingsAreTerminal(soIdRaw) {
  const sid = Number(soIdRaw);
  if (!Number.isFinite(sid) || sid <= 0) return;
  const { getPickingBySaleOrder } = await import('./delivery.service.js');
  const picks = await getPickingBySaleOrder(sid);
  const allowed = new Set(['done', 'cancel']);
  for (const pk of picks || []) {
    const st = String(pk?.state ?? '')
      .trim()
      .toLowerCase();
    if (!st || allowed.has(st)) continue;
    throw new Error(
      `Delivery incomplete: transfer ${pk?.id ?? '?'} (${String(pk?.name ?? '').slice(0, 40)}) is still "${st}" in Odoo. Sync will retry.`
    );
  }
}

/**
 * After a failed delivery RPC pass, align Odoo to the queued snapshot without re-running validate/move writes.
 */
async function tryMarkDeliverySyncedAfterQtyHeal(item, saleOrderId, queuePayload) {
  const soId = Number(saleOrderId);
  if (!Number.isFinite(soId) || soId <= 0 || item?.id == null) return false;
  const updates = deliveredUpdatesFromQueuePayload(queuePayload);
  const ctx = repairContextFromQueuePayload(queuePayload);
  const repair = await attemptDeliveredQtyHealForSaleOrder(soId, queuePayload, {
    maxRounds: 2,
    pickingIds: ctx.pickingIds,
    deliveryLines: ctx.deliveryLines,
  });
  if (!repair.ok) return false;
  try {
    await verifyAllSaleOrderPickingsAreTerminal(soId);
    if (updates.length > 0) await verifySaleOrderLineDeliveredOnOdoo(updates);
    await syncQueueDb.markSynced(Number(item.id));
    log('queue', `delivery id=${item.id} SO ${soId} marked synced after heal (no duplicate upload)`);
    return true;
  } catch (_) {
    return false;
  }
}

/** Picking/move context from a queue payload (held delivery or payment snapshot). */
function repairContextFromQueuePayload(queuePayload) {
  const p = queuePayload || {};
  const pickingIds = [];
  const deliveryLines = [];
  if (Array.isArray(p.pickings) && p.pickings.length > 0) {
    for (const b of p.pickings) {
      const pid = Number(b?.pickingId ?? b?.picking_id);
      if (Number.isFinite(pid) && pid > 0) pickingIds.push(pid);
      for (const line of b?.deliveryLines || []) deliveryLines.push(line);
    }
  } else if (p.pickingId != null) {
    const pid = Number(p.pickingId);
    if (Number.isFinite(pid) && pid > 0) pickingIds.push(pid);
    for (const line of p.deliveryLines || []) deliveryLines.push(line);
  }
  return { pickingIds, deliveryLines };
}

/** Picking/move context from in-memory delivery blocks during queue processing. */
function repairContextFromDeliveryBlocks(blocks) {
  const pickingIds = [];
  const deliveryLines = [];
  for (const b of blocks || []) {
    const pid = Number(b?.pickingId ?? b?.picking_id);
    if (Number.isFinite(pid) && pid > 0) pickingIds.push(pid);
    for (const line of b?.deliveryLines || []) deliveryLines.push(line);
  }
  return { pickingIds, deliveryLines };
}

/**
 * When queue payload lost move ids (stale duplicate row, crash mid-sync), rebuild targets from
 * mobile SOL qty + live Odoo pickings so repair can still align stock moves before invoicing.
 */
async function buildOdooRepairContextFromAuthoritativeUpdates(saleOrderId, deliveredUpdates) {
  const soId = Number(saleOrderId);
  if (!Number.isFinite(soId) || soId <= 0) return { pickingIds: [], deliveryLines: [] };

  const orderLines = await saleOrderLinesDb.getSaleOrderLinesByOrderIds([soId]).catch(() => []);
  const qtyByProduct = new Map();
  for (const u of deliveredUpdates || []) {
    const line = (orderLines || []).find((l) => Number(l?.id) === Number(u?.lineId));
    if (!line) continue;
    const pid = Number(line.product_id);
    const q = roundDeliveredQty3(u.qty_delivered);
    if (!Number.isFinite(pid) || !Number.isFinite(q) || q <= 0) continue;
    qtyByProduct.set(pid, (qtyByProduct.get(pid) || 0) + q);
  }
  if (qtyByProduct.size === 0) return { pickingIds: [], deliveryLines: [] };

  const { getPickingBySaleOrder, getStockMovesByPickingId } = await import('./delivery.service.js');
  const pickings = await getPickingBySaleOrder(soId).catch(() => []);
  const pickingIds = [];
  const deliveryLines = [];
  for (const pk of pickings || []) {
    const pickingId = Number(pk?.id);
    if (!Number.isFinite(pickingId) || pickingId <= 0) continue;
    pickingIds.push(pickingId);
    const moves = await getStockMovesByPickingId(pickingId).catch(() => []);
    const movesByProduct = new Map();
    for (const mv of moves || []) {
      const productId = Number(Array.isArray(mv?.product_id) ? mv.product_id[0] : mv?.product_id);
      const mid = Number(mv?.id);
      if (!Number.isFinite(productId) || !Number.isFinite(mid)) continue;
      const list = movesByProduct.get(productId) || [];
      list.push(mid);
      movesByProduct.set(productId, list);
    }
    for (const [productId, targetQty] of qtyByProduct.entries()) {
      const mids = movesByProduct.get(productId) || [];
      if (!mids.length) continue;
      const moveId = mids[mids.length - 1];
      deliveryLines.push({ moveId, productId, qty_done: targetQty });
    }
  }
  return { pickingIds, deliveryLines };
}

async function resolveRepairContextForSaleOrder(saleOrderId, deliveredUpdates, partialContext = {}) {
  let pickingIds = Array.isArray(partialContext.pickingIds) ? [...partialContext.pickingIds] : [];
  let deliveryLines = Array.isArray(partialContext.deliveryLines) ? [...partialContext.deliveryLines] : [];
  if (pickingIds.length === 0 || deliveryLines.length === 0) {
    const built = await buildOdooRepairContextFromAuthoritativeUpdates(saleOrderId, deliveredUpdates);
    if (pickingIds.length === 0) pickingIds = built.pickingIds;
    if (deliveryLines.length === 0) deliveryLines = built.deliveryLines;
  }
  return { pickingIds, deliveryLines };
}

/** Single entry for rare qty drift — used by delivery finalize, payment guard, and invoice recovery. */
async function attemptDeliveredQtyHealForSaleOrder(saleOrderId, queuePayload = null, extraContext = {}) {
  const soId = Number(saleOrderId);
  if (!Number.isFinite(soId) || soId <= 0) return { ok: true, reason: 'invalid so' };
  const updates = await collectAuthoritativeDeliveredUpdates(soId, queuePayload);
  if (!updates.length) return { ok: true, reason: 'no delivered rows' };
  const fromPayload = repairContextFromQueuePayload(queuePayload);
  const mergedCtx = await resolveRepairContextForSaleOrder(soId, updates, {
    pickingIds: extraContext.pickingIds?.length ? extraContext.pickingIds : fromPayload.pickingIds,
    deliveryLines: extraContext.deliveryLines?.length ? extraContext.deliveryLines : fromPayload.deliveryLines,
  });
  return repairOdooDeliveredQuantitiesFromMobile(soId, updates, {
    ...mergedCtx,
    maxRounds: extraContext.maxRounds ?? 2,
  });
}

/** Product totals from mobile snapshot (every SO line the driver confirmed at payment). */
async function buildRequestedQtyByProductFromDeliveredUpdates(saleOrderId, deliveredUpdates) {
  const soId = Number(saleOrderId);
  if (!Number.isFinite(soId) || soId <= 0) return new Map();
  const orderLines = await saleOrderLinesDb.getSaleOrderLinesByOrderIds([soId]).catch(() => []);
  const byProduct = new Map();
  for (const u of deliveredUpdates || []) {
    const line = (orderLines || []).find((l) => Number(l?.id) === Number(u?.lineId));
    if (!line) continue;
    const pid = Number(line.product_id);
    const q = roundDeliveredQty3(u.qty_delivered);
    if (!Number.isFinite(pid) || pid <= 0 || !Number.isFinite(q) || q <= 0) continue;
    byProduct.set(pid, (byProduct.get(pid) || 0) + q);
  }
  return byProduct;
}

/** Block markSynced when payload still has product qty that never mapped to stock moves. */
function assertNoUnresolvedRequestedQuantities(requestedRemainingByProduct, saleOrderId) {
  const unresolved = Array.from((requestedRemainingByProduct || new Map()).entries())
    .filter(([_, rem]) => Number(rem) > 0.0001)
    .map(([pid, rem]) => `${pid}:${Number(rem).toFixed(3)}`);
  if (unresolved.length === 0) return;
  throw new Error(
    `Delivery incomplete: stock moves missing for SO ${saleOrderId} (${unresolved.join(', ')}). Sync will retry.`
  );
}

/** When payload lists move targets, verify Odoo stock.move / move.line qty_done matches before completing delivery. */
async function verifyStockMoveQtyDoneMatchesPayload(blocks, options = {}) {
  const expectedByMove = new Map();
  for (const b of blocks || []) {
    for (const line of b?.deliveryLines || []) {
      const mid = Number(line?.moveId ?? line?.move_id);
      const qty = roundDeliveredQty3(line?.qty_done);
      if (!Number.isFinite(mid) || mid <= 0 || !Number.isFinite(qty) || qty <= 0) continue;
      expectedByMove.set(mid, qty);
    }
  }
  if (expectedByMove.size === 0) return;

  const { getStockMoveLinesByMoveIds } = await import('./delivery.service.js');
  const { callOdoo } = await import('./index.service.js');
  const tol = options.tolerance ?? DELIVERED_QTY_VERIFY_TOL;
  const moveIds = [...expectedByMove.keys()];

  let moveRows = [];
  try {
    moveRows =
      (await callOdoo('stock.move', 'read', [moveIds], {
        fields: ['id', 'quantity_done'],
      })) || [];
  } catch (_) {
    moveRows = [];
  }
  const moveById = new Map((Array.isArray(moveRows) ? moveRows : []).map((m) => [Number(m.id), m]));

  for (const [mid, expected] of expectedByMove) {
    let actual = NaN;
    const mv = moveById.get(mid);
    if (mv?.quantity_done != null) actual = roundDeliveredQty3(mv.quantity_done);
    if (!Number.isFinite(actual)) {
      const mls = await getStockMoveLinesByMoveIds([mid]).catch(() => []);
      actual = roundDeliveredQty3(
        (mls || []).reduce((sum, ml) => sum + (Number(ml?.qty_done) || 0), 0)
      );
    }
    if (!Number.isFinite(actual) || Math.abs(actual - expected) > tol) {
      throw new Error(
        `Move ${mid} qty_done mismatch: mobile ${expected}, Odoo ${actual}. Sync will retry.`
      );
    }
  }
}

/** Ensure sale.order.line qty_delivered on Odoo matches mobile (throws on mismatch). */
async function verifySaleOrderLineDeliveredOnOdoo(deliveredUpdates, options = {}) {
  if (!Array.isArray(deliveredUpdates) || deliveredUpdates.length === 0) return;
  const ids = [
    ...new Set(deliveredUpdates.map((u) => Number(u.lineId)).filter((n) => Number.isFinite(n) && n > 0)),
  ];
  if (!ids.length) return;
  const { callOdoo } = await import('./index.service.js');
  const rows =
    (await callOdoo('sale.order.line', 'read', [ids], {
      fields: ['id', 'qty_delivered'],
    })) || [];
  const list = Array.isArray(rows) ? rows : [];
  const byId = new Map(list.map((r) => [Number(r.id), r]));
  const tol = options.tolerance ?? DELIVERED_QTY_VERIFY_TOL;
  for (const u of deliveredUpdates) {
    const lid = Number(u.lineId);
    const exp = roundDeliveredQty3(u.qty_delivered);
    if (!Number.isFinite(lid) || lid <= 0 || u.qty_delivered == null || !Number.isFinite(Number(exp))) continue;
    const row = byId.get(lid);
    const actual = row != null ? roundDeliveredQty3(row.qty_delivered) : NaN;
    if (!Number.isFinite(actual) || Math.abs(actual - exp) > tol) {
      throw new Error(
        `Delivered qty mismatch on SO line ${lid}: mobile ${exp}, Odoo ${actual}. Sync will retry.`
      );
    }
  }
}

async function applySaleOrderLineDeliveredUpdates(deliveredUpdates, saleOrderId = null) {
  if (!Array.isArray(deliveredUpdates) || deliveredUpdates.length === 0) return;
  const soId = Number(saleOrderId);
  if (Number.isFinite(soId) && soId > 0) {
    const { applySaleOrderLineUpdatesBatch, updateSaleOrderLineQtyDelivered } = await import(
      './saleOrderLine.service.js'
    );
    try {
      await applySaleOrderLineUpdatesBatch(soId, { delivered: deliveredUpdates });
      return;
    } catch (batchErr) {
      log(
        'queue',
        `delivery SO line batch write failed for SO ${soId}, falling back per line: ${String(batchErr?.message || batchErr).slice(0, 100)}`
      );
      for (const u of deliveredUpdates) {
        if (u.lineId == null || u.qty_delivered == null) continue;
        try {
          await updateSaleOrderLineQtyDelivered(u.lineId, Number(u.qty_delivered));
        } catch (lineErr) {
          logWarn('queue delivery (SO line delivered fallback)', lineErr);
        }
      }
      return;
    }
  }
  const { updateSaleOrderLineQtyDelivered } = await import('./saleOrderLine.service.js');
  for (const u of deliveredUpdates) {
    if (u.lineId == null || u.qty_delivered == null) continue;
    await updateSaleOrderLineQtyDelivered(u.lineId, Number(u.qty_delivered));
  }
}

/**
 * Idempotent repair: re-write SOL qty_delivered (+ best-effort move qty on done pickings) until Odoo matches mobile.
 * Does not change enqueue/checkout flow — only heals partial sync before invoice/payment completion.
 */
async function repairOdooDeliveredQuantitiesFromMobile(saleOrderId, deliveredUpdates, options = {}) {
  const updates = Array.isArray(deliveredUpdates) ? deliveredUpdates : [];
  if (!updates.length) return { ok: true, reason: 'no delivered rows' };

  const { getStockMovesByPickingId, applyPickingDeliverySnapshotIdempotent } = await import(
    './delivery.service.js'
  );

  const resolved = await resolveRepairContextForSaleOrder(saleOrderId, updates, {
    pickingIds: options.pickingIds,
    deliveryLines: options.deliveryLines,
  });
  const pickingIds = resolved.pickingIds;
  const deliveryLines = resolved.deliveryLines;

  const qtyDoneByMoveId = new Map();
  for (const line of deliveryLines) {
    const mid = line.moveId ?? line.move_id;
    const qtyN = line.qty_done != null ? Number(line.qty_done) : NaN;
    if (mid == null || !Number.isFinite(qtyN) || qtyN <= 0) continue;
    qtyDoneByMoveId.set(Number(mid), qtyN);
  }

  const applyMoveQtyTargets = async () => {
    if (!pickingIds.length || qtyDoneByMoveId.size === 0) return;
    for (const pickingId of pickingIds) {
      const moves = await getStockMovesByPickingId(pickingId).catch(() => []);
      const blockDeliveryLines = [];
      for (const mv of moves || []) {
        const mid = Number(mv?.id);
        const target = qtyDoneByMoveId.get(mid);
        if (!Number.isFinite(mid) || target == null) continue;
        const productId = Number(Array.isArray(mv?.product_id) ? mv.product_id[0] : mv?.product_id);
        blockDeliveryLines.push({
          moveId: mid,
          productId: Number.isFinite(productId) ? productId : undefined,
          qty_done: target,
        });
      }
      if (!blockDeliveryLines.length) continue;
      try {
        await applyPickingDeliverySnapshotIdempotent(pickingId, { deliveryLines: blockDeliveryLines });
      } catch (_) {
        /* done transfers may be readonly on some DBs — SOL write below is authoritative */
      }
    }
  };

  const maxRounds = options.maxRounds ?? 2;
  const roundDelays = [150, 350];
  let lastReason = 'unknown';
  for (let round = 0; round < maxRounds; round++) {
    try {
      await applyMoveQtyTargets();
      await applySaleOrderLineDeliveredUpdates(updates, saleOrderId);
      await verifySaleOrderLineDeliveredOnOdoo(updates);
      log('queue', `delivery qty repair OK for SO ${saleOrderId} (round ${round + 1})`);
      return { ok: true };
    } catch (e) {
      lastReason = e?.message || String(e);
      if (round < maxRounds - 1) {
        await new Promise((r) => setTimeout(r, roundDelays[round] ?? 1200));
      }
    }
  }
  return { ok: false, reason: lastReason };
}

/** Advance-payment invoice create + post — used only after qty heal when first attempt hit "nothing to invoice". */
async function tryCreateAndPostDeliveredInvoice(soId) {
  const soNum = Number(soId);
  if (!Number.isFinite(soNum) || soNum <= 0) return { ok: false, reason: 'invalid sale order id' };
  const {
    createAdvancePaymentWizard,
    createInvoicesFromWizard,
    postInvoice,
    getInvoiceIdAfterCreate,
    getSaleOrderInvoiceIds,
    firstInvoiceId,
    getInvoiceState,
  } = await import('./invoice.service.js');
  try {
    const wizardId = await createAdvancePaymentWizard(soNum);
    if (wizardId == null) return { ok: false, reason: 'wizard create failed' };
    const createResult = await createInvoicesFromWizard(wizardId);
    const resId =
      getInvoiceIdAfterCreate(createResult) ?? firstInvoiceId(await getSaleOrderInvoiceIds(soNum));
    if (resId == null) return { ok: false, reason: 'no invoice id from wizard' };
    await postInvoice(resId);
    const st = await getInvoiceState(resId).catch(() => ({}));
    if (String(st?.state || '').toLowerCase() !== 'posted') {
      return { ok: false, reason: `invoice ${resId} not posted` };
    }
    return { ok: true, resId: Number(resId) };
  } catch (e) {
    return { ok: false, reason: e?.message || String(e) };
  }
}

async function ensureBackendDeliveredMatchesMobileBeforePaymentComplete(soId, paymentPayload = null) {
  const soNum = Number(soId);
  if (!Number.isFinite(soNum) || soNum <= 0) return { ok: true };

  let queuePayload = paymentPayload;
  try {
    const pendingDel = await syncQueueDb.getPendingDeliveryItemBySaleOrderId(soNum);
    if (pendingDel?.payload) {
      queuePayload = { ...(queuePayload || {}), ...pendingDel.payload };
    }
  } catch (_) {
    /* non-fatal */
  }

  const updates = await collectAuthoritativeDeliveredUpdates(soNum, queuePayload);
  if (!updates.length) return { ok: true };

  const runHealAndVerify = async () => {
    const heal = await attemptDeliveredQtyHealForSaleOrder(soNum, queuePayload);
    if (!heal.ok) return heal;
    await verifySaleOrderLineDeliveredOnOdoo(updates);
    return { ok: true };
  };

  try {
    await verifySaleOrderLineDeliveredOnOdoo(updates);
    return { ok: true };
  } catch (verifyErr) {
    log('queue', `payment SO ${soNum}: delivered qty drift — repair (${String(verifyErr?.message || verifyErr).slice(0, 80)})`);
    return runHealAndVerify();
  }
}

/**
 * Do not mark payment queue rows complete until Odoo confirms delivery + invoice (+ cash/cheque paid when applicable).
 * Prevents mobile "pending" clearing while back office stays "To Invoice" / partial delivery.
 */
function pickingsTerminalForCompletion(pickings) {
  for (const pk of pickings || []) {
    const st = String(pk?.state ?? '').trim().toLowerCase();
    if (st && st !== 'done' && st !== 'cancel') return false;
  }
  return true;
}

async function verifyOdooSaleOrderCompletionBeforePaymentMarkSynced(soId, paymentPayload = {}) {
  const soNum = Number(soId);
  if (!Number.isFinite(soNum) || soNum <= 0) {
    return { ok: false, reason: 'invalid sale order id' };
  }

  const pending = await syncQueueDb.getPending();
  for (const q of pending || []) {
    const qSo = Number((q.payload || {}).saleOrderId ?? (q.payload || {}).sale_order_id);
    if (qSo !== soNum) continue;
    if (
      q.action_type === syncQueueDb.ACTION_DELIVERY ||
      q.action_type === syncQueueDb.ACTION_INVENTORY_UPDATE
    ) {
      return { ok: false, reason: `pending ${q.action_type} queue id=${q.id}` };
    }
  }

  const { getPickingBySaleOrder } = await import('./delivery.service.js');
  const pickings = await getPickingBySaleOrder(soNum);
  if (!pickingsTerminalForCompletion(pickings)) {
    const openPk = (pickings || []).find((pk) => {
      const st = String(pk?.state ?? '').trim().toLowerCase();
      return st && st !== 'done' && st !== 'cancel';
    });
    return { ok: false, reason: `picking ${openPk?.id} still "${openPk?.state}"` };
  }

  const {
    getSaleOrderForPayment,
    getSaleOrderInvoiceIds,
    normalizeSaleOrderInvoiceIds,
    getInvoiceState,
    loadPostedUnpaidInvoicesForSaleOrder,
  } = await import('./invoice.service.js');

  const orderInfo = await getSaleOrderForPayment(soNum).catch(() => null);
  if (!orderInfo) {
    return { ok: false, reason: 'sale order not found on Odoo' };
  }

  const invStatus = String(orderInfo.invoice_status || '').toLowerCase();
  const invIds = normalizeSaleOrderInvoiceIds(
    orderInfo.invoice_ids ?? (await getSaleOrderInvoiceIds(soNum).catch(() => []))
  );
  let hasPostedInvoice = false;
  for (const invId of invIds) {
    const inv = await getInvoiceState(invId).catch(() => ({}));
    if (String(inv?.state || '').toLowerCase() === 'posted') {
      hasPostedInvoice = true;
      break;
    }
  }

  if (!hasPostedInvoice) {
    return { ok: false, reason: `invoice_status=${invStatus || 'unknown'} (no posted invoice on Odoo)` };
  }

  if (invStatus === 'to invoice' || invStatus === 'no' || invStatus === 'upselling') {
    if (hasPostedInvoice) {
      log('queue', `payment SO ${soNum}: invoice_status still "${invStatus}" but posted invoice exists — accept`);
    } else {
      return { ok: false, reason: `sale order still "${invStatus}" on Odoo after invoice step` };
    }
  }

  const payments = paymentPayload?.payments || [];
  const needsCashOrCheque = payments.some((pm) => pm.type === 'cash' || pm.type === 'check');
  if (needsCashOrCheque) {
    const open = await loadPostedUnpaidInvoicesForSaleOrder(soNum);
    if (open.length > 0) {
      let stillUnpaid = false;
      for (const inv of open) {
        const invId = Number(inv?.id ?? inv);
        if (!Number.isFinite(invId)) continue;
        const st = await getInvoiceState(invId).catch(() => ({}));
        const posted = String(st?.state || '').toLowerCase() === 'posted';
        const ps = String(st?.payment_state || '').toLowerCase();
        const residual = Number(st?.amount_residual ?? 0);
        if (posted && ps !== 'paid' && ps !== 'in_payment' && residual > 0.02) {
          stillUnpaid = true;
          break;
        }
      }
      if (stillUnpaid) {
        return { ok: false, reason: `${open.length} posted invoice(s) still unpaid on Odoo` };
      }
    }
  }

  return { ok: true };
}

async function updatePaymentQueuePipeline(itemId, payload, pipelinePatch) {
  const merged = {
    ...(payload || {}),
    _syncPipeline: {
      ...(payload?._syncPipeline || {}),
      ...pipelinePatch,
      updatedAt: Date.now(),
    },
  };
  try {
    await syncQueueDb.updateQueueItemPayload(Number(itemId), merged);
  } catch (e) {
    logWarn('queue payment pipeline persist', e);
  }
  return merged;
}

/** Cash/cheque lines must be reconciled on Odoo before we treat the payment step as done. */
async function verifyCashChequePaymentsRegisteredOnOdoo(soId, payments) {
  const cashCheque = (payments || []).filter((pm) => pm.type === 'cash' || pm.type === 'check');
  if (cashCheque.length === 0) return { ok: true };

  const { loadPostedUnpaidInvoicesForSaleOrder, getInvoiceState } = await import('./invoice.service.js');
  const open = await loadPostedUnpaidInvoicesForSaleOrder(soId);
  for (const inv of open) {
    const invId = Number(inv?.id ?? inv);
    if (!Number.isFinite(invId)) continue;
    const st = await getInvoiceState(invId).catch(() => ({}));
    const posted = String(st?.state || '').toLowerCase() === 'posted';
    const ps = String(st?.payment_state || '').toLowerCase();
    const residual = Number(st?.amount_residual ?? 0);
    if (posted && ps !== 'paid' && ps !== 'in_payment' && residual > 0.02) {
      return { ok: false, reason: `invoice ${invId} still unpaid (residual=${residual})` };
    }
  }
  return { ok: true };
}

/** Chatter only after delivery + invoice (+ payment when required) are confirmed on Odoo. */
async function paymentPipelineReadyForChatter(soId, paymentPayload) {
  const check = await verifyOdooSaleOrderCompletionBeforePaymentMarkSynced(soId, paymentPayload);
  if (!check.ok) {
    log('queue', `payment SO ${soId}: defer chatter — ${check.reason}`);
    return false;
  }
  const payments = paymentPayload?.payments || [];
  const reg = await verifyCashChequePaymentsRegisteredOnOdoo(soId, payments);
  if (!reg.ok) {
    log('queue', `payment SO ${soId}: defer chatter — ${reg.reason}`);
    return false;
  }
  return true;
}

/** Mark payment queue row synced only when Odoo pipeline is complete (idempotent retries safe). */
async function markPaymentQueueItemSyncedWhenBackendComplete(item, soId, paymentPayload) {
  const payload = paymentPayload || item?.payload || {};
  await pullSaleOrderHeaderAfterPayment(soId);

  let check = await verifyOdooSaleOrderCompletionBeforePaymentMarkSynced(soId, payload);
  if (!check.ok) {
    log('queue', `payment id=${item?.id} SO ${soId} kept pending — ${check.reason}`);
    return false;
  }
  const payments = payload?.payments || [];
  const needsCashOrCheque = payments.some((pm) => pm.type === 'cash' || pm.type === 'check');
  if (needsCashOrCheque) {
    const reg = await verifyCashChequePaymentsRegisteredOnOdoo(soId, payments);
    if (!reg.ok) {
      log('queue', `payment id=${item?.id} SO ${soId} kept pending — ${reg.reason}`);
      return false;
    }
  }
  await syncQueueDb.markSynced(Number(item.id));
  try {
    const { clearCheckoutResume, pruneStaleCheckoutResumeEntries } = await import('./checkoutResume.service.js');
    await clearCheckoutResume(soId);
    await pruneStaleCheckoutResumeEntries();
  } catch (_) { /* non-fatal */ }
  return true;
}

/** Process pending sync queue: push delivery and payment actions to Odoo. Run at start of runSync. */
async function processSyncQueue() {
  if (_processSyncQueuePromise) {
    log('queue', 'already processing; awaiting same run');
    return _processSyncQueuePromise;
  }
  _processSyncQueuePromise = (async () => {
    const retryStarted = Date.now();
    let pass = 0;
    let lastPending = -1;
    const alreadySyncedSaleOrderIds = new Set(await syncQueueDb.getSyncedPaymentSaleOrderIds());
    const chatterPostedInThisRun = new Set();
    try {
      while (Date.now() - retryStarted < QUEUE_SYNC_RETRY_WINDOW_MS && pass < QUEUE_SYNC_MAX_PASSES) {
        pass++;
        const pendingAtStart = await syncQueueDb.getPendingCount();
        if (pendingAtStart === 0) break;

        try {
      let queueSnap = await syncQueueDb.getPending();
      if (!queueSnap.length) return;
      log('queue', `processing ${queueSnap.length} pending`);

      const saleOrderIdFromQueuePayload = (payload) => {
        const raw = payload?.saleOrderId ?? payload?.sale_id ?? payload?.orderId ?? payload?.order_id;
        const n = raw != null ? Number(raw) : NaN;
        return Number.isFinite(n) && n > 0 ? n : null;
      };

      /**
       * Several UI paths enqueue queue rows concurrently (double tap).
       * Running two delivery syncs for one SO validates stock twice and duplicates qty_done / valuations.
       * Keep the newest pending row per SO for **non-held** deliveries; supersede older ones without Odoo RPC.
       */
      const supersedeStaleQueueRows = async (items, label, { allowHeldPayload = false } = {}) => {
        const keeperBySo = new Map();
        const sortedAsc = [...items].sort((a, b) => Number(a?.id ?? 0) - Number(b?.id ?? 0));
        for (const it of sortedAsc) {
          const soId = saleOrderIdFromQueuePayload(it.payload || {});
          if (soId == null) continue;
          keeperBySo.set(soId, it);
        }
        const keepIds = new Set(
          Array.from(keeperBySo.values())
            .filter((row) => row != null && row.id != null)
            .map((row) => Number(row.id))
        );
        for (const it of items) {
          const payload = it.payload || {};
          if (
            !allowHeldPayload &&
            (payload?.holdUntilPayment === true || payload?.holdUntilComplete === true)
          )
            continue;
          const soId = saleOrderIdFromQueuePayload(payload);
          if (soId == null) continue;
          if (!keepIds.has(Number(it.id))) {
            try {
              await syncQueueDb.markSynced(Number(it.id));
              log('queue', `${label} superseded duplicate id=${it.id} SO ${soId} (newer snapshot kept)`);
            } catch (_) {
              /* ignore */
            }
          }
        }
      };

      let deliveryPre = queueSnap.filter((p) => p.action_type === syncQueueDb.ACTION_DELIVERY);
      let inventoryPre = queueSnap.filter((p) => p.action_type === syncQueueDb.ACTION_INVENTORY_UPDATE);

      /** Dedupe every pending delivery row per SO (held + open) so offline replay never validates twice. */
      await supersedeStaleQueueRows(deliveryPre, 'delivery', { allowHeldPayload: true });
      const inventoryOpen = inventoryPre.filter((d) => !(d.payload || {}).holdUntilComplete);
      await supersedeStaleQueueRows(inventoryOpen, 'inventory_update');
      /** Held empty-return rows can duplicate if Confirm is tapped twice; keep latest snapshot before sync clears hold. */
      const inventoryHeldAll = inventoryPre.filter((d) => (d.payload || {}).holdUntilComplete === true);
      await supersedeStaleQueueRows(inventoryHeldAll, 'inventory_update (held)', {
        allowHeldPayload: true,
      });

      queueSnap = await syncQueueDb.getPending();
      if (!queueSnap.length) return;

      const delivery = queueSnap.filter((p) => p.action_type === syncQueueDb.ACTION_DELIVERY);
      const payment = queueSnap.filter((p) => p.action_type === syncQueueDb.ACTION_PAYMENT);
      const inventoryUpdate = queueSnap.filter((p) => p.action_type === syncQueueDb.ACTION_INVENTORY_UPDATE);

      log('queue', `after dedupe ${queueSnap.length} pending`);

      // Keep only the latest pending payment item per sale order to avoid duplicate chatter posts.
      const latestPaymentItemBySaleOrder = new Map();
      for (const item of payment) {
        const p = item.payload || {};
        const saleOrderId = p.saleOrderId ?? p.sale_id;
        const soId = saleOrderId != null ? Number(saleOrderId) : NaN;
        if (Number.isNaN(soId)) continue;
        latestPaymentItemBySaleOrder.set(soId, item);
      }
      const dedupedPayment = [];
      for (const item of payment) {
        const p = item.payload || {};
        const saleOrderId = p.saleOrderId ?? p.sale_id;
        const soId = saleOrderId != null ? Number(saleOrderId) : NaN;
        if (Number.isNaN(soId)) {
          dedupedPayment.push(item);
          continue;
        }
        const latest = latestPaymentItemBySaleOrder.get(soId);
        if (latest && Number(latest.id) !== Number(item.id)) {
          await syncQueueDb.markSynced(Number(item.id));
          log('queue', `skip duplicate pending payment id=${item.id} (SO ${soId}); latest id=${latest.id}`);
          continue;
        }
        dedupedPayment.push(item);
      }

      async function tryAttachPrintedInvoicePdfToSaleOrder(soId, invoiceId, orderName = '') {
        const invId = Number(invoiceId);
        if (!Number.isFinite(invId) || invId <= 0) return null;
        try {
          const { createSaleOrderAttachment } = await import('./proofAttachment.service.js');
          const { renderPostedInvoicePdfBase64 } = await import('./invoicePdfReport.service.js');
          const pdfBase64 = await renderPostedInvoicePdfBase64(invId);
          if (!pdfBase64 || String(pdfBase64).length < 200) {
            log('queue', `invoice PDF render empty for account.move id=${invId} (SO ${soId}) — no attachment; check report rights`);
            return null;
          }
          const safeOrder = String(orderName || `SO-${soId}`).replace(/[^\w.-]+/g, '_');
          const fileName = `${safeOrder}_printed_invoice.pdf`;
          const attId = await createSaleOrderAttachment(soId, pdfBase64, fileName, 'application/pdf');
          return Number(attId);
        } catch (e) {
          logWarn('queue payment attach invoice pdf', e);
          return null;
        }
      }
      const {
        updateSaleOrderLineQty,
        updateSaleOrderLineQtyDelivered,
        confirmSaleOrder,
      } = await import('./saleOrderLine.service');
      const {
        getPickingBySaleOrder,
        getPickingState,
        getStockMovesByPickingId,
        applyPickingDeliverySnapshotIdempotent,
        updateStockMoveQuantityDone,
        createMoveLine,
        actionConfirmPicking,
        actionAssignPicking,
        actionCancelPicking,
        validatePickingWithContext,
      } = await import('./delivery.service');
      const {
        getSaleOrderForPayment,
        getSaleOrderInvoiceIds,
        normalizeSaleOrderInvoiceIds,
        getInvoiceState,
        getInvoiceIdAfterCreate,
        firstInvoiceId,
        resolveInitialInvoiceIdForPaymentSync,
        loadPostedUnpaidInvoicesForSaleOrder,
        pickInvoiceIdForPaymentAmount,
        createAdvancePaymentWizard,
        createInvoicesFromWizard,
        postInvoice,
        getPaymentsByInvoiceIds,
        createPaymentRegisterWizard,
        executePaymentRegister,
      } = await import('./invoice.service');

      /** Normalize delivery payload: multi-picking `pickings[]` or legacy single `pickingId`. */
      const pickingsBlocksFromPayload = (payload) => {
        const p = payload || {};
        if (Array.isArray(p.pickings) && p.pickings.length > 0) {
          return p.pickings.map((b) => ({
            pickingId: b.pickingId ?? b.picking_id,
            moveUpdates: b.moveUpdates || [],
            moveLineUpdates: b.moveLineUpdates || [],
            deliveryLines: b.deliveryLines || [],
          }));
        }
        const pid = p.pickingId ?? p.picking_id;
        if (pid != null) {
          return [
            {
              pickingId: pid,
              moveUpdates: p.moveUpdates || [],
              moveLineUpdates: p.moveLineUpdates || [],
              deliveryLines: p.deliveryLines || [],
            },
          ];
        }
        return [];
      };

      const roundQty3 = (q) => Math.round(Number(q) * 1000) / 1000;

      /** Push one delivery queue row to Odoo and mark synced. Used from main delivery pass and pre-payment flush. */
      const processOneDeliveryQueueItem = async (item, syncOptions = {}) => {
        const saleOrderIdRaw = (item.payload || {}).saleOrderId ?? (item.payload || {}).sale_id;
        const snapshot = await resolveDeliveredSnapshotForSync(saleOrderIdRaw, item.payload || {});
        const p = snapshot.payload || {};
        const saleOrderId = p.saleOrderId ?? p.sale_id;
        const demandEdit = p.demandEdit === true;
        const orderLineUpdates = demandEdit ? p.orderLineUpdates || [] : [];
        const saleOrderLineDeliveredUpdates = snapshot.updates || [];
        const requestedQtyByProduct = p.requestedQtyByProduct || {};
        let blocks = pickingsBlocksFromPayload(p);
        const requestedDeliveryRemainingByProduct = new Map(
          Object.entries(requestedQtyByProduct || {})
            .map(([pidRaw, qtyRaw]) => [Number(pidRaw), Number(qtyRaw) || 0])
            .filter(([pid, qty]) => Number.isFinite(pid) && qty > 0)
        );
        let validatedAnyPicking = false;
        const targetPickingIds = new Set();

        const applySoLineOrderedQty = async () => {
          if (!orderLineUpdates.length) return;
          const soNum = saleOrderId != null ? Number(saleOrderId) : NaN;
          if (Number.isFinite(soNum) && soNum > 0) {
            const { applySaleOrderLineUpdatesBatch } = await import('./saleOrderLine.service.js');
            try {
              await applySaleOrderLineUpdatesBatch(soNum, { ordered: orderLineUpdates });
              return;
            } catch (batchErr) {
              log(
                'queue',
                `delivery SO ordered batch failed for SO ${soNum}, per-line fallback: ${String(batchErr?.message || batchErr).slice(0, 100)}`
              );
            }
          }
          for (const u of orderLineUpdates) {
            if (u.lineId == null || u.product_uom_qty == null) continue;
            await updateSaleOrderLineQty(u.lineId, u.product_uom_qty);
          }
        };

        const applySoLineDeliveredQty = async () => {
          await applySaleOrderLineDeliveredUpdates(saleOrderLineDeliveredUpdates, saleOrderId);
        };

        /** After all pickings validated: one SOL write from the mobile snapshot (not during validate). */
        const applyMobileDeliveredQtyToOdooOnce = async () => {
          if (!saleOrderLineDeliveredUpdates.length) return;
          await applySoLineDeliveredQty();
        };

        /** Must match mobile snapshot on Odoo before markSynced (financial — no partial success). */
        const finalizeDeliveryConsistencyCheck = async () => {
          assertNoUnresolvedRequestedQuantities(requestedDeliveryRemainingByProduct, saleOrderId);
          await verifyAllSaleOrderPickingsAreTerminal(saleOrderId);
          if (blocks.length > 0) {
            await verifyStockMoveQtyDoneMatchesPayload(blocks);
          }
          await applyMobileDeliveredQtyToOdooOnce();
          if (saleOrderLineDeliveredUpdates.length === 0) return;
          const repairCtx = repairContextFromDeliveryBlocks(blocks);
          try {
            await verifySaleOrderLineDeliveredOnOdoo(saleOrderLineDeliveredUpdates);
          } catch (verifyErr) {
            const heal = await attemptDeliveredQtyHealForSaleOrder(saleOrderId, p, {
              maxRounds: 2,
              pickingIds: repairCtx.pickingIds,
              deliveryLines: repairCtx.deliveryLines,
            });
            if (!heal.ok) throw verifyErr;
            await verifySaleOrderLineDeliveredOnOdoo(saleOrderLineDeliveredUpdates);
          }
        };

        try {
          if (demandEdit) {
            await applySoLineOrderedQty();
          }
          const snapshotByProduct = await buildRequestedQtyByProductFromDeliveredUpdates(
            saleOrderId,
            saleOrderLineDeliveredUpdates
          );
          for (const [pid, qty] of snapshotByProduct.entries()) {
            const prev = Number(requestedDeliveryRemainingByProduct.get(pid)) || 0;
            if (qty > prev + 0.0001) {
              requestedDeliveryRemainingByProduct.set(pid, qty);
            }
          }
        } catch (soLineErr) {
          logWarn('queue delivery (order line / delivery snapshot)', soLineErr);
          throw soLineErr;
        }

        if (blocks.length === 0 && requestedDeliveryRemainingByProduct.size > 0 && saleOrderId != null) {
          try {
            const picks = await getPickingBySaleOrder(saleOrderId);
            blocks = (picks || [])
              .filter((pk) => pk?.id != null)
              .map((pk) => ({
                pickingId: Number(pk.id),
                moveUpdates: [],
                moveLineUpdates: [],
                deliveryLines: [],
              }));
          } catch (_) {
            /* keep empty blocks; handled below */
          }
        }

        const hasPickings = blocks.length > 0;
        if (!hasPickings) {
          const soNum = saleOrderId != null ? Number(saleOrderId) : NaN;
          if (Number.isFinite(soNum) && soNum > 0 && saleOrderLineDeliveredUpdates.length > 0) {
            const odooPickings = await getPickingBySaleOrder(soNum).catch(() => []);
            const hasOdooTransfers = (odooPickings || []).some((pk) => {
              const st = String(pk?.state ?? '').trim().toLowerCase();
              return pk?.id != null && st !== 'cancel';
            });
            if (hasOdooTransfers) {
              throw new Error(
                `Delivery incomplete: SO ${soNum} has warehouse transfers but payload has no picking blocks. Sync will retry.`
              );
            }
          }
          if (requestedDeliveryRemainingByProduct.size > 0) {
            log(
              'queue',
              `delivery fallback: no pickings for SO ${saleOrderId}; apply SO delivered qty only (requested map size=${requestedDeliveryRemainingByProduct.size})`
            );
          }
          {
            const soCrew = saleOrderId != null ? Number(saleOrderId) : NaN;
            if (Number.isFinite(soCrew) && soCrew > 0) await writeSaleOrderCrewFromPaymentPayload(soCrew, p);
          }
          await finalizeDeliveryConsistencyCheck();
          await syncQueueDb.markSynced(Number(item.id));
          log(
            'queue',
            `delivery SO ${saleOrderId} — no pickings (SO line updates only), synced id=${item.id}`
          );
          return;
        }

        for (const block of blocks) {
          let pickingId = block.pickingId;
          if (pickingId == null && saleOrderId != null) {
            const pickings = await getPickingBySaleOrder(saleOrderId);
            const first = Array.isArray(pickings) ? pickings[0] : null;
            if (first?.state === 'done') {
              log('queue', `delivery block skipped — SO ${saleOrderId} first picking already done`);
              pickingId = null;
            } else {
              pickingId = first?.id ?? null;
            }
          }
          if (pickingId == null) {
            const blockHasWork =
              (block.deliveryLines?.length > 0) ||
              (block.moveLineUpdates?.length > 0) ||
              (block.moveUpdates?.length > 0) ||
              requestedDeliveryRemainingByProduct.size > 0;
            if (blockHasWork) {
              throw new Error(
                `Delivery incomplete: missing picking id for SO ${saleOrderId}. Sync will retry.`
              );
            }
            logWarn('queue delivery', new Error('No picking id for block (SO ' + saleOrderId + ')'));
            continue;
          }
          targetPickingIds.add(Number(pickingId));

          const moveUpdates = demandEdit ? block.moveUpdates || [] : [];
          const moveLineUpdates = block.moveLineUpdates || [];
          const deliveryLines = Array.isArray(block.deliveryLines) ? [...block.deliveryLines] : [];

          try {
            const stateRows = await getPickingState(pickingId);
            const pick = Array.isArray(stateRows) ? stateRows[0] : stateRows;
            if (pick?.state === 'done') {
              log('queue', `delivery picking ${pickingId} already done — align move qty_done from mobile snapshot`);
              try {
                await applyPickingDeliverySnapshotIdempotent(pickingId, { deliveryLines });
              } catch (_) {
                /* readonly on some done transfers */
              }
              validatedAnyPicking = true;
              continue;
            }
          } catch (_) { }

          /**
           * Edge case: line demand changed from 0 -> >0 while offline may leave payload without a concrete move mapping.
           * Rebuild missing delivery lines from requested product totals using current picking moves.
           */
          const topUpDeliveryLinesFromRequested = async () => {
            for (const line of deliveryLines) {
              const pid = Number(line?.productId ?? line?.product_id);
              const q = Number(line?.qty_done) || 0;
              if (!Number.isFinite(pid) || q <= 0 || !requestedDeliveryRemainingByProduct.has(pid)) continue;
              const prev = Number(requestedDeliveryRemainingByProduct.get(pid)) || 0;
              requestedDeliveryRemainingByProduct.set(pid, Math.max(0, prev - q));
            }

            const moves = await getStockMovesByPickingId(pickingId).catch(() => []);
            const moveIdsByProduct = new Map();
            for (const mv of moves || []) {
              const pid = Number(Array.isArray(mv?.product_id) ? mv.product_id[0] : mv?.product_id);
              const mid = Number(mv?.id);
              if (!Number.isFinite(pid) || !Number.isFinite(mid)) continue;
              const list = moveIdsByProduct.get(pid) || [];
              list.push(mid);
              moveIdsByProduct.set(pid, list);
            }

            /**
             * Critical fallback for 0 -> positive offline edits:
             * some Odoo DBs do not have a stock.move row yet when demand was initially zero.
             * Create a move in the target picking so qty_done can be posted and invoiced correctly.
             */
            const createMissingMoveForProduct = async (productId, qty) => {
              try {
                const { callOdoo, callOdooArgs } = await import('./index.service.js');
                const picks = await callOdoo(
                  'stock.picking',
                  'search_read',
                  [[['id', '=', Number(pickingId)]]],
                  { fields: ['id', 'location_id', 'location_dest_id'], limit: 1 }
                );
                const pick = Array.isArray(picks) ? picks[0] : null;
                const srcLoc = Array.isArray(pick?.location_id) ? pick.location_id[0] : pick?.location_id;
                const dstLoc = Array.isArray(pick?.location_dest_id) ? pick.location_dest_id[0] : pick?.location_dest_id;
                if (!srcLoc || !dstLoc) return null;
                let productUomId = null;
                try {
                  const pRows = await callOdoo(
                    'product.product',
                    'search_read',
                    [[['id', '=', Number(productId)]]],
                    { fields: ['uom_id'], limit: 1 }
                  );
                  const p = Array.isArray(pRows) ? pRows[0] : null;
                  productUomId = Array.isArray(p?.uom_id) ? p.uom_id[0] : p?.uom_id;
                } catch (_) {
                  /* non-fatal; try create without explicit uom */
                }
                const moveId = await callOdooArgs('stock.move', 'create', [[{
                  name: `SO ${saleOrderId || ''} offline delivery`,
                  picking_id: Number(pickingId),
                  product_id: Number(productId),
                  product_uom_qty: Number(qty),
                  ...(productUomId ? { product_uom: Number(productUomId) } : {}),
                  location_id: Number(srcLoc),
                  location_dest_id: Number(dstLoc),
                }]]);
                const mid = Number(moveId);
                if (!Number.isFinite(mid) || mid <= 0) return null;
                const list = moveIdsByProduct.get(Number(productId)) || [];
                list.push(mid);
                moveIdsByProduct.set(Number(productId), list);
                log('queue', `delivery created missing move ${mid} for product ${productId} on picking ${pickingId}`);
                return mid;
              } catch (e) {
                log(
                  'queue',
                  `delivery create missing move failed for product ${productId} on picking ${pickingId}: ${String(e?.message || e).slice(0, 120)}`
                );
                try {
                  const { callOdoo, callOdooArgs } = await import('./index.service.js');
                  const picks = await callOdoo(
                    'stock.picking',
                    'search_read',
                    [[['id', '=', Number(pickingId)]]],
                    { fields: ['id', 'location_id', 'location_dest_id'], limit: 1 }
                  );
                  const pick = Array.isArray(picks) ? picks[0] : null;
                  const srcLoc = Array.isArray(pick?.location_id) ? pick.location_id[0] : pick?.location_id;
                  const dstLoc = Array.isArray(pick?.location_dest_id) ? pick.location_dest_id[0] : pick?.location_dest_id;
                  if (srcLoc && dstLoc) {
                    const moveLineId = await callOdooArgs('stock.move.line', 'create', [[{
                      picking_id: Number(pickingId),
                      product_id: Number(productId),
                      qty_done: Number(qty),
                      location_id: Number(srcLoc),
                      location_dest_id: Number(dstLoc),
                    }]]);
                    const mlid = Number(moveLineId);
                    if (Number.isFinite(mlid) && mlid > 0) {
                      log('queue', `delivery direct move line fallback created id=${mlid} product=${productId} picking=${pickingId}`);
                      return -1;
                    }
                  }
                } catch (e2) {
                  log(
                    'queue',
                    `delivery direct move line fallback failed for product ${productId} on picking ${pickingId}: ${String(e2?.message || e2).slice(0, 120)}`
                  );
                }
                return null;
              }
            };

            for (const [productId, remainingQty] of requestedDeliveryRemainingByProduct.entries()) {
              let missing = Number(remainingQty) || 0;
              if (missing <= 0.0001) continue;
              let mids = moveIdsByProduct.get(productId) || [];
              if (mids.length === 0) {
                const createdMid = await createMissingMoveForProduct(productId, missing);
                if (createdMid === -1) {
                  requestedDeliveryRemainingByProduct.set(productId, 0);
                  continue;
                }
                mids = createdMid != null ? [createdMid] : [];
              }
              if (mids.length === 0) continue;

              // Attach the missing quantity to the last move for this product in this picking.
              const targetMoveId = Number(mids[mids.length - 1]);
              const existingLine = deliveryLines.find((l) => Number(l?.moveId ?? l?.move_id) === targetMoveId);
              if (existingLine) {
                existingLine.qty_done = (Number(existingLine.qty_done) || 0) + missing;
              } else {
                deliveryLines.push({
                  moveId: targetMoveId,
                  productId,
                  qty_done: missing,
                });
              }
              requestedDeliveryRemainingByProduct.set(productId, 0);
            }
          };

          try {
            await topUpDeliveryLinesFromRequested();
            /**
             * One stock.picking write applies move demand, move lines, and quantity_done together
             * (single Odoo transaction). Falls back to legacy per-line RPCs if the server rejects it.
             */
            const applyResult = await applyPickingDeliverySnapshotIdempotent(pickingId, {
              moveUpdates,
              moveLineUpdates,
              deliveryLines,
            });
            if (applyResult?.mode !== 'already_applied') {
              await verifyStockMoveQtyDoneMatchesPayload([
                { pickingId, deliveryLines, moveUpdates, moveLineUpdates },
              ]);
            }
          } catch (updateErr) {
            const msg = (updateErr?.message || String(updateErr)).toLowerCase();
            const recordDeleted = msg.includes('does not exist or has been deleted') || msg.includes('has been deleted');
            if (recordDeleted) {
              log('queue', `delivery updates skipped (record deleted): ${msg.slice(0, 80)}`);
            } else {
              throw updateErr;
            }
          }

          /** Queue retry pass > 1: verify only — never re-write qty (prevents offline duplicate stacking). */
          if (Number(syncOptions.queuePass) > 1 && deliveryLines.length > 0) {
            await verifyStockMoveQtyDoneMatchesPayload([
              { pickingId, deliveryLines, moveUpdates, moveLineUpdates },
            ]);
            await new Promise((r) => setTimeout(r, 400));
            log(
              'queue',
              `delivery retry pass ${syncOptions.queuePass}: verified qty_done before validate picking ${pickingId}`
            );
          }

          const tryValidateOne = async () => {
            await validatePickingWithContext(pickingId, {
              skip_backorder: true,
              cancel_backorder: true,
            });
          };
          /** Avoid swallowing hard validate failures behind a broad "already..." match (Odoo qty/invoice mismatches). */
          const validateMsgOkToSkip = (msg) => {
            const v = (msg || '').toLowerCase();
            return (
              v.includes('does not exist') ||
              v.includes('has been deleted') ||
              v.includes('nothing to validate') ||
              v.includes('nothing backorder') ||
              v.includes('has already been validated') ||
              v.includes('already been validated') ||
              v.includes('transfer has already been processed') ||
              v.includes('picking has already been processed') ||
              (v.includes('done') &&
                (v.includes('transfer') || v.includes('picking') || v.includes('already')))
            );
          };
          const mightBeStockReservation = (msg) => {
            const v = (msg || '').toLowerCase();
            return (
              v.includes('availability') ||
              v.includes('available') ||
              v.includes('not available') ||
              v.includes('reserved') ||
              v.includes('reservation') ||
              v.includes('quantity') ||
              v.includes('assigned') ||
              v.includes('waiting') ||
              v.includes('move line') ||
              v.includes('need to supply')
            );
          };

          try {
            try {
              try {
                await actionConfirmPicking(pickingId);
                log('queue', `delivery action_confirm picking ${pickingId}`);
              } catch (confirmErr) {
                log(
                  'queue',
                  `delivery action_confirm picking ${pickingId} (non-fatal): ${String(confirmErr?.message || confirmErr).slice(0, 120)}`
                );
              }
              await actionAssignPicking(pickingId);
              log('queue', `delivery action_assign picking ${pickingId}`);
            } catch (assignErr) {
              log(
                'queue',
                `delivery action_assign picking ${pickingId} (non-fatal): ${String(assignErr?.message || assignErr).slice(0, 120)}`
              );
            }
            try {
              await tryValidateOne();
              validatedAnyPicking = true;
              log('queue', `delivery validated picking ${pickingId} (skip_backorder)`);
            } catch (validateErr) {
              const vMsgRaw = String(validateErr?.message || validateErr);
              const vMsg = vMsgRaw.toLowerCase();
              if (validateMsgOkToSkip(vMsg)) {
                log('queue', `delivery validate skipped (picking ${pickingId}): ${vMsg.slice(0, 80)}`);
                validatedAnyPicking = true;
              } else if (mightBeStockReservation(vMsg)) {
                log('queue', `delivery validate failed (stock?) picking ${pickingId} — retry after action_assign`);
                try {
                  await actionAssignPicking(pickingId);
                } catch (_) {
                  /* second assign optional */
                }
                await tryValidateOne();
                validatedAnyPicking = true;
                log('queue', `delivery validated picking ${pickingId} after assign retry`);
              } else {
                throw validateErr;
              }
            }
          } catch (validateErr) {
            const vMsg = String(validateErr?.message || validateErr).toLowerCase();
            if (validateMsgOkToSkip(vMsg)) {
              log('queue', `delivery validate skipped (picking already done or deleted): ${vMsg.slice(0, 60)}`);
              validatedAnyPicking = true;
            } else {
              throw validateErr;
            }
          }

          block.deliveryLines = deliveryLines;
        }

        if (validatedAnyPicking && saleOrderId != null) {
          try {
            const refreshedPickings = await getPickingBySaleOrder(saleOrderId);
            for (const pick of refreshedPickings || []) {
              const pid = pick?.id != null ? Number(pick.id) : null;
              const state = String(pick?.state || '').toLowerCase();
              if (pid == null) continue;
              if (state === 'done' || state === 'cancel') continue;
              if (targetPickingIds.has(pid)) continue;
              try {
                await actionCancelPicking(pid);
                log('queue', `delivery auto-cancelled backorder picking ${pid} for SO ${saleOrderId}`);
              } catch (cancelErr) {
                log(
                  'queue',
                  `delivery backorder cancel skipped for picking ${pid}: ${String(cancelErr?.message || cancelErr).slice(0, 120)}`
                );
              }
            }
          } catch (refreshErr) {
            log(
              'queue',
              `delivery backorder cleanup skipped for SO ${saleOrderId}: ${String(refreshErr?.message || refreshErr).slice(0, 120)}`
            );
          }
        }

        {
          const soCrew = saleOrderId != null ? Number(saleOrderId) : NaN;
          if (Number.isFinite(soCrew) && soCrew > 0) await writeSaleOrderCrewFromPaymentPayload(soCrew, p);
        }
        await finalizeDeliveryConsistencyCheck();
        await syncQueueDb.markSynced(Number(item.id));
        log('queue', `delivery synced id=${item.id} (${blocks.length} picking block(s))`);
      };

      for (const item of delivery) {
        const p0 = item.payload || {};
        if (p0.holdUntilPayment === true) {
          log('queue', `delivery id=${item.id} SO ${p0.saleOrderId ?? p0.sale_id} held until payment — skip`);
          continue;
        }
        try {
          await processOneDeliveryQueueItem(item, { queuePass: pass });
        } catch (e) {
          logWarn('queue delivery', e);
          const errMsg = String(e?.message || e).toLowerCase();
          if (
            errMsg.includes('delivered qty mismatch') ||
            errMsg.includes('mismatch on so line') ||
            errMsg.includes('qty_done mismatch') ||
            errMsg.includes('delivery incomplete')
          ) {
            try {
              const soId = Number(p0.saleOrderId ?? p0.sale_id);
              if (Number.isFinite(soId) && soId > 0) {
                const healed = await tryMarkDeliverySyncedAfterQtyHeal(item, soId, p0);
                if (healed) {
                  log('queue', `delivery id=${item.id} SO ${soId} marked synced after idempotent heal`);
                }
              }
            } catch (repairErr) {
              logWarn('queue delivery (mismatch repair retry)', repairErr);
            }
          }
        }
      }

      // Inventory queue item purpose in current flow:
      // local inventory is reduced immediately on device (is_locally_modified=1), then delivery sync updates Odoo.
      // After delivery sync succeeds, clear local-modified flags so next inventory pull can overwrite with server truth.
      for (const item of inventoryUpdate) {
        try {
          const p = item.payload || {};
          if (p.holdUntilComplete === true) {
            log('queue', `inventory id=${item.id} SO ${p.saleOrderId ?? p.sale_id} held until complete — skip`);
            continue;
          }
          const locationId = p.locationId != null ? Number(p.locationId) : null;
          const saleOrderId = p.saleOrderId != null ? Number(p.saleOrderId) : null;
          const updates = Array.isArray(p.updates) ? p.updates : [];

          if (locationId == null || updates.length === 0) {
            await syncQueueDb.markSynced(Number(item.id));
            log('queue', `inventory synced id=${item.id} (no-op payload)`);
            continue;
          }

          const emptyReturnLines = updates
            .map((u) => ({
              productId: u?.productId != null ? Number(u.productId) : null,
              qty: Number(u?.incrementQuantity),
            }))
            .filter((u) => Number.isFinite(u.productId) && Number.isFinite(u.qty) && u.qty > 0);

          let movedByPicking = false;
          if (saleOrderId != null && emptyReturnLines.length > 0) {
            try {
              const { callOdoo, callOdooArgs } = await import('./index.service.js');
              const salePickings = await callOdoo(
                'stock.picking',
                'search_read',
                [[['sale_id', '=', saleOrderId]]],
                {
                  fields: ['id', 'name', 'picking_type_id', 'location_id', 'location_dest_id'],
                  order: 'id desc',
                  limit: 1,
                }
              );
              const basePicking = Array.isArray(salePickings) ? salePickings[0] : null;
              const vehicleLocationId = Array.isArray(basePicking?.location_id)
                ? basePicking.location_id[0]
                : basePicking?.location_id;
              const customerLocationId = Array.isArray(basePicking?.location_dest_id)
                ? basePicking.location_dest_id[0]
                : basePicking?.location_dest_id;
              const fallbackCustomerLocRows = await callOdoo(
                'stock.location',
                'search_read',
                [[['usage', '=', 'customer']]],
                { fields: ['id'], limit: 1 }
              );
              const fallbackCustomerLocationId = Array.isArray(fallbackCustomerLocRows) && fallbackCustomerLocRows[0]?.id != null
                ? Number(fallbackCustomerLocRows[0].id)
                : null;
              const srcLocId =
                customerLocationId != null ? Number(customerLocationId) : fallbackCustomerLocationId;
              const destLocId = vehicleLocationId != null ? Number(vehicleLocationId) : null;

              if (srcLocId && destLocId) {
                const internalType = await callOdoo(
                  'stock.picking.type',
                  'search_read',
                  [[['code', '=', 'internal']]],
                  { fields: ['id'], limit: 1 }
                );
                const incomingType = await callOdoo(
                  'stock.picking.type',
                  'search_read',
                  [[['code', '=', 'incoming']]],
                  { fields: ['id'], limit: 1 }
                );
                const outgoingType = await callOdoo(
                  'stock.picking.type',
                  'search_read',
                  [[['code', '=', 'outgoing']]],
                  { fields: ['id'], limit: 1 }
                );
                const pickingTypeId =
                  (Array.isArray(internalType) && internalType[0]?.id != null ? Number(internalType[0].id) : null) ??
                  (Array.isArray(incomingType) && incomingType[0]?.id != null ? Number(incomingType[0].id) : null) ??
                  (Array.isArray(outgoingType) && outgoingType[0]?.id != null ? Number(outgoingType[0].id) : null);

                if (pickingTypeId != null) {
                  const pickingId = await callOdooArgs('stock.picking', 'create', [
                    {
                      picking_type_id: Number(pickingTypeId),
                      origin: `SO ${saleOrderId} EMPTY RETURN`,
                      location_id: Number(srcLocId),
                      location_dest_id: Number(destLocId),
                      move_ids_without_package: emptyReturnLines.map((line) => [
                        0,
                        0,
                        {
                          name: `Empty Return SO ${saleOrderId}`,
                          product_id: Number(line.productId),
                          product_uom_qty: Number(line.qty),
                          location_id: Number(srcLocId),
                          location_dest_id: Number(destLocId),
                        },
                      ]),
                    },
                  ]);

                  await callOdooArgs('stock.picking', 'action_confirm', [[Number(pickingId)]]);
                  try {
                    await actionAssignPicking(Number(pickingId));
                  } catch (_) {
                    /* assignment can fail for return/incoming style operations */
                  }
                  const returnMoves = await callOdoo(
                    'stock.move',
                    'search_read',
                    [[['picking_id', '=', Number(pickingId)]]],
                    { fields: ['id', 'product_id'], limit: 200 }
                  );
                  for (const line of emptyReturnLines) {
                    const mv = (returnMoves || []).find((m) => {
                      const pid = Array.isArray(m.product_id) ? m.product_id[0] : m.product_id;
                      return Number(pid) === Number(line.productId);
                    });
                    if (mv?.id != null) {
                      const moveId = Number(mv.id);
                      await updateStockMoveQuantityDone(moveId, Number(line.qty));
                      try {
                        await createMoveLine(Number(pickingId), moveId, Number(line.productId), Number(line.qty));
                      } catch (_) {
                        /* line may already exist from assignment/update */
                      }
                    }
                  }
                  await validatePickingWithContext(Number(pickingId), {
                    skip_backorder: true,
                    cancel_backorder: true,
                  });
                  movedByPicking = true;
                  log('queue', `inventory empty return synced via picking id=${pickingId} SO=${saleOrderId} lines=${emptyReturnLines.length}`);
                }
              }
            } catch (emptyMoveErr) {
              logWarn('queue inventory_update empty-return picking', emptyMoveErr);
            }
          }

          let allInventoryUpdatesSynced = true;
          if (!movedByPicking) {
            const { setQuantQuantityAtLocation, adjustQuantQuantityAtLocation } = await import('./vehicleInventory.service.js');
            for (const u of updates) {
              const productId = u?.productId != null ? Number(u.productId) : null;
              if (productId == null) continue;
              const inc = Number(u?.incrementQuantity);
              const targetQty = Number(u?.newQuantity);
              try {
                if (Number.isFinite(inc) && inc !== 0) {
                  await adjustQuantQuantityAtLocation(locationId, productId, inc);
                } else if (Number.isFinite(targetQty)) {
                  await setQuantQuantityAtLocation(locationId, productId, targetQty);
                }
                await vehicleInventoriesDb.clearLocalModificationFlagByLocation(locationId, productId);
              } catch (invErr) {
                allInventoryUpdatesSynced = false;
                logWarn(
                  'queue inventory_update upload',
                  new Error(`loc=${locationId} product=${productId}: ${String(invErr?.message || invErr).slice(0, 160)}`)
                );
              }
            }
          } else {
            for (const u of updates) {
              const productId = u?.productId != null ? Number(u.productId) : null;
              if (productId == null) continue;
              await vehicleInventoriesDb.clearLocalModificationFlagByLocation(locationId, productId);
            }
          }

          if (allInventoryUpdatesSynced) {
            await syncQueueDb.markSynced(Number(item.id));
            log('queue', `inventory synced id=${item.id} location=${locationId} items=${updates.length}`);
          } else {
            log(
              'queue',
              `inventory id=${item.id} partially failed; keep pending for retry (location=${locationId}, items=${updates.length})`
            );
          }
        } catch (e) {
          logWarn('queue inventory_update', e);
        }
      }

      // Backend API sequence for each payment queue item (offline → sync):
      // 1. sale.advance.payment.inv create { advance_payment_method: "delivered" } context active_model=sale.order, active_ids=[sale_order_id]
      // 2. sale.advance.payment.inv create_invoices [[wizardId]] → result.res_id = invoice id (account.move)
      // 3. account.move action_post [[res_id]]
      // 4. Credit only: stop here (invoice posted, no payment register).
      // 5. Cash/Cheque: account.payment.register create [{ amount, journal_id, payment_date }] context active_model=account.move, active_ids=[res_id] → wizard id
      //    journal_id = vehicle cash_journal_id for cash, vehicle check_journal_id for cheque (from payload or fleet.vehicle by license_plate)
      // 6. account.payment.register action_create_payments [[wizardId]]

      for (const item of dedupedPayment) {
        let invoiceBlockFailedNoItemsToInvoice = false;
        let postedInvoiceId = null;
        try {
          const p = item.payload || {};
          if (p.holdUntilComplete === true) {
            log('queue', `payment id=${item.id} SO ${p.saleOrderId ?? p.sale_id} held until complete — skip`);
            continue;
          }
          const saleOrderId = p.saleOrderId ?? p.sale_id;
          const soId = typeof saleOrderId === 'number' ? saleOrderId : parseInt(saleOrderId, 10);
          if (saleOrderId == null || Number.isNaN(soId)) {
            logWarn('queue payment', new Error('Invalid sale_order_id'));
            continue;
          }

          /** Driver / porter on sale.order as early as possible (not only after delivery is synced). */
          await writeSaleOrderCrewFromPaymentPayload(soId, p);

          const pendingForFlush = await syncQueueDb.getPending();
          const heldDeliveriesForSo = (pendingForFlush || []).filter(
            (q) =>
              q.action_type === syncQueueDb.ACTION_DELIVERY &&
              Number((q.payload || {}).saleOrderId ?? (q.payload || {}).sale_id) === soId &&
              (q.payload || {}).holdUntilPayment === true
          );
          if (heldDeliveriesForSo.length > 0) {
            const sortedHeld = [...heldDeliveriesForSo].sort((a, b) => Number(a.id) - Number(b.id));
            const latestHeld = sortedHeld[sortedHeld.length - 1];
            const superseded = sortedHeld.slice(0, -1);

            // Apply only the latest held payload snapshot to avoid stale line quantities
            // from older duplicate queue rows overwriting delivery/invoice quantities.
            let flushOk = false;
            try {
              const released = {
                ...latestHeld,
                payload: { ...(latestHeld.payload || {}), holdUntilPayment: false },
              };
              await processOneDeliveryQueueItem(released, { queuePass: pass });
              flushOk = true;
            } catch (flushErr) {
              logWarn('queue delivery (flush before payment)', flushErr);
              try {
                const healed = await tryMarkDeliverySyncedAfterQtyHeal(
                  latestHeld,
                  soId,
                  latestHeld.payload || {}
                );
                if (healed) {
                  flushOk = true;
                  log('queue', `payment SO ${soId}: delivery flush recovered after qty heal (no duplicate RPC)`);
                }
              } catch (repairErr) {
                logWarn('queue delivery (repair before payment)', repairErr);
              }
            }

            // Older held rows are noise once the latest snapshot applies; only clear them if flush succeeded
            // so a failed delivery retry is not left with every duplicate marked "synced" and no real upload.
            if (flushOk && superseded.length > 0) {
              for (const older of superseded) {
                try {
                  await syncQueueDb.markSynced(Number(older.id));
                  log('queue', `delivery superseded row synced id=${older.id} SO ${soId}`);
                } catch (skipErr) {
                  logWarn('queue delivery (mark superseded)', skipErr);
                }
              }
            }
          }

          /**
           * Hard guard: never create/post invoice while this SO still has any pending delivery sync row.
           * This keeps "ordered/delivered/invoiced" aligned and avoids intermittent partial invoicing.
           */
          const pendingAfterFlush = await syncQueueDb.getPending();
          const remainingDeliveryForSo = (pendingAfterFlush || []).filter(
            (q) =>
              (q.action_type === syncQueueDb.ACTION_DELIVERY ||
                q.action_type === syncQueueDb.ACTION_INVENTORY_UPDATE) &&
              Number((q.payload || {}).saleOrderId ?? (q.payload || {}).sale_id) === soId
          );
          if (remainingDeliveryForSo.length > 0) {
            const latestDelivery = [...remainingDeliveryForSo].sort(
              (a, b) => Number(b.id) - Number(a.id)
            )[0];
            let recoveredDelivery = false;
            if (latestDelivery?.action_type === syncQueueDb.ACTION_DELIVERY) {
              try {
                const healed = await tryMarkDeliverySyncedAfterQtyHeal(
                  latestDelivery,
                  soId,
                  latestDelivery.payload || {}
                );
                if (healed) {
                  recoveredDelivery = true;
                  log('queue', `payment SO ${soId}: delivery marked synced after qty heal`);
                }
              } catch (retryErr) {
                logWarn('queue delivery (repair while payment waiting)', retryErr);
              }
            }
            const pendingAfterRepair = await syncQueueDb.getPending();
            const stillDelivery = (pendingAfterRepair || []).filter(
              (q) =>
                (q.action_type === syncQueueDb.ACTION_DELIVERY ||
                  q.action_type === syncQueueDb.ACTION_INVENTORY_UPDATE) &&
                Number((q.payload || {}).saleOrderId ?? (q.payload || {}).sale_id) === soId
            );
            if (!recoveredDelivery || stillDelivery.length > 0) {
              log(
                'queue',
                `payment id=${item.id} SO ${soId} delayed: waiting for delivery sync (${stillDelivery.length} pending)`
              );
              continue;
            }
          }

          const payments = p.payments || [];
          const orderName = p.orderName ?? `Order ${saleOrderId}`;
          const skipPaymentCreation = alreadySyncedSaleOrderIds.has(soId);

          if (!skipPaymentCreation) {
            try {
              const orderInfo = await getSaleOrderForPayment(saleOrderId);
              if (!orderInfo) {
                logWarn('queue payment', new Error('Sale order not found — will retry on next sync'));
                continue;
              }
              const paymentSumRound2 = payments
                .filter((pm) => pm.type === 'cash' || pm.type === 'check')
                .reduce((s, pm) => s + Math.round(Number(pm.amount || 0) * 100) / 100, 0);
              const payloadTotalRound2 =
                p.total != null && Number.isFinite(Number(p.total))
                  ? Math.round(Number(p.total) * 100) / 100
                  : null;
              const expectedPaymentTotal =
                paymentSumRound2 > 0 ? paymentSumRound2 : payloadTotalRound2;

              const initialTarget = await resolveInitialInvoiceIdForPaymentSync(soId, {
                expectedPaymentTotal,
                orderInfo,
              });
              let resId = initialTarget.resId;
              let invoiceAlreadyPosted = initialTarget.invoiceAlreadyPosted;
              if (resId != null) {
                const invState = await getInvoiceState(resId).catch(() => ({}));
                if (invState?.state === 'posted') {
                  invoiceAlreadyPosted = true;
                  postedInvoiceId = Number(resId);
                } else if (invState?.state === 'draft') {
                  log('queue', `payment SO ${saleOrderId}: post existing draft invoice res_id=${resId}`);
                  await postInvoice(resId);
                  invoiceAlreadyPosted = true;
                  postedInvoiceId = Number(resId);
                }
              }

              if (!invoiceAlreadyPosted) {
                if (resId != null) {
                  const invStateAgain = await getInvoiceState(resId).catch(() => ({}));
                  if ((invStateAgain?.state || '').toLowerCase() === 'posted') {
                    log('queue', `payment SO ${saleOrderId}: invoice ${resId} already posted — skip post`);
                    invoiceAlreadyPosted = true;
                    postedInvoiceId = Number(resId);
                  } else if ((invStateAgain?.state || '').toLowerCase() === 'draft') {
                    log('queue', `payment SO ${saleOrderId}: post existing draft invoice res_id=${resId}`);
                    await postInvoice(resId);
                    invoiceAlreadyPosted = true;
                    postedInvoiceId = Number(resId);
                  }
                  if (!invoiceAlreadyPosted) {
                    log('queue', `payment SO ${saleOrderId}: post existing invoice res_id=${resId}`);
                    await postInvoice(resId);
                    invoiceAlreadyPosted = true;
                    postedInvoiceId = Number(resId);
                  }
                } else {
                  const preInvoiceAlign = await ensureBackendDeliveredMatchesMobileBeforePaymentComplete(soId, p);
                  if (!preInvoiceAlign.ok) {
                    invoiceBlockFailedNoItemsToInvoice = true;
                    log(
                      'queue',
                      `payment SO ${soId} delayed: mobile delivered qty not on Odoo before invoice (${String(preInvoiceAlign.reason || '').slice(0, 100)})`
                    );
                    continue;
                  }
                  log('queue', `payment SO ${saleOrderId}: Step 1 — create advance payment wizard (context active_ids [${saleOrderId}])`);
                  const wizardId = await createAdvancePaymentWizard(saleOrderId);
                  if (wizardId == null) {
                    logWarn('queue payment', new Error('Step 1 failed: advance payment wizard create returned null'));
                  } else {
                    log('queue', `payment SO ${saleOrderId}: Step 2 — create_invoices [[${wizardId}]]`);
                    const createResult = await createInvoicesFromWizard(wizardId);
                    resId = getInvoiceIdAfterCreate(createResult) ?? firstInvoiceId(await getSaleOrderInvoiceIds(saleOrderId));
                    if (resId == null) {
                      logWarn('queue payment', new Error('Step 2 failed: no res_id in create_invoices result'));
                    } else {
                      log('queue', `payment SO ${saleOrderId}: Step 3 — action_post [[${resId}]]`);
                      await postInvoice(resId);
                      log('queue', `payment SO ${saleOrderId}: invoice created and posted res_id=${resId}`);
                      postedInvoiceId = Number(resId);
                    }
                  }
                }
                const onlyCredit = payments.length > 0 && payments.every((pm) => pm.type === 'credit');
                if (onlyCredit && resId != null) {
                  log('queue', `payment SO ${saleOrderId}: credit only — invoice posted res_id=${resId}, no payment register`);
                  await updatePaymentQueuePipeline(item.id, p, { invoicePosted: true, paymentsRegistered: true });
                }
              }
              const onlyCredit = payments.length > 0 && payments.every((pm) => pm.type === 'credit');
              if (onlyCredit && resId != null) {
                log('queue', `payment SO ${saleOrderId}: credit only (invoice already posted) — no payment register`);
                if (await markPaymentQueueItemSyncedWhenBackendComplete(item, soId, p)) {
                  alreadySyncedSaleOrderIds.add(soId);
                }
              }

              const hasCashOrCheque = payments.some((pm) => pm.type === 'cash' || pm.type === 'check');
              if (hasCashOrCheque) {
                const round2 = (n) => Math.round(Number(n) * 100) / 100;
                let openInvoices = await loadPostedUnpaidInvoicesForSaleOrder(soId);
                if (!openInvoices.length && resId != null) {
                  const bootstrap = await getInvoiceState(resId).catch(() => ({}));
                  if ((bootstrap?.state || '').toLowerCase() === 'posted') {
                    const ps = (bootstrap?.payment_state || '').toLowerCase();
                    if (ps === 'not_paid' || ps === 'partial' || ps === 'in_payment') {
                      const ar = round2(Number(bootstrap.amount_residual) || 0);
                      if (ar > 0.02) {
                        openInvoices = [
                          {
                            id: resId,
                            amount_residual: ar,
                            payment_state: bootstrap.payment_state,
                          },
                        ];
                      }
                    }
                  }
                }

                if (!openInvoices.length) {
                  if (resId == null) {
                    invoiceBlockFailedNoItemsToInvoice = true;
                    logWarn(
                      'queue payment',
                      new Error(
                        'No invoice for cash/cheque — skipping payment register until invoice exists (complete delivery sync first).'
                      )
                    );
                  } else {
                    const paidCheck = await getInvoiceState(resId).catch(() => ({}));
                    if ((paidCheck?.payment_state || '').toLowerCase() === 'paid') {
                      log(
                        'queue',
                        `payment SO ${saleOrderId}: no open balance — invoice ${resId} paid (skip register)`
                      );
                      await updatePaymentQueuePipeline(item.id, p, { invoicePosted: true, paymentsRegistered: true });
                    } else {
                      invoiceBlockFailedNoItemsToInvoice = true;
                      logWarn(
                        'queue payment',
                        new Error(
                          `No posted unpaid invoice for SO ${saleOrderId} — cannot register cash/cheque (invoice ${resId} state unexpected).`
                        )
                      );
                    }
                  }
                } else {
                  let resolvedCashId = null;
                  let resolvedChequeId = null;
                  try {
                    const user = await getUserSession();
                    const licensePlate = user?.licensePlate || user?.license_plate || '';
                    const vehicleId = user?.vehicleId != null ? user.vehicleId : null;
                    const { getVehicleJournalsByLicensePlate } = await import('./vehicle.service.js');
                    const vehicleJournals = await getVehicleJournalsByLicensePlate(licensePlate, vehicleId);
                    resolvedCashId = vehicleJournals.cashJournalId ?? null;
                    resolvedChequeId = vehicleJournals.chequeJournalId ?? null;
                    if (resolvedCashId == null && resolvedChequeId == null) {
                      const { getCashTypeJournalIds } = await import('./journal.service.js');
                      const ids = await getCashTypeJournalIds();
                      resolvedCashId = ids.cashJournalId ?? null;
                      resolvedChequeId = ids.chequeJournalId ?? null;
                      log('queue', `payment SO ${saleOrderId}: journals fallback (no vehicle) cash=${resolvedCashId ?? '—'} cheque=${resolvedChequeId ?? '—'}`);
                    } else {
                      log('queue', `payment SO ${saleOrderId}: journals from logged-in vehicle (${licensePlate || vehicleId || '—'}) cash=${resolvedCashId ?? '—'} cheque=${resolvedChequeId ?? '—'}`);
                    }
                  } catch (resolveErr) {
                    logWarn('queue payment resolve journals', resolveErr);
                  }

                  const dateStr = p.paymentDate || new Date().toISOString().slice(0, 10);
                  for (const pm of payments) {
                    if (pm.type === 'credit') continue;
                    const amount = Number(pm.amount);
                    const journalId = (pm.journalId != null && Number.isFinite(Number(pm.journalId)))
                      ? Number(pm.journalId)
                      : (pm.type === 'cash' ? resolvedCashId : pm.type === 'check' ? resolvedChequeId : null);
                    const desiredAmount = round2(amount);
                    if (!desiredAmount || journalId == null) {
                      logWarn('queue payment', new Error(`${pm.type === 'cash' ? 'Cash' : 'Cheque'} journal id not found. Skipping amount ${amount}`));
                      continue;
                    }

                    openInvoices = await loadPostedUnpaidInvoicesForSaleOrder(soId);
                    const targetResId = pickInvoiceIdForPaymentAmount(openInvoices, desiredAmount);
                    if (targetResId == null) {
                      logWarn(
                        'queue payment',
                        new Error(
                          `No invoice with open balance for ${pm.type} amount=${desiredAmount} (SO ${saleOrderId}).`
                        )
                      );
                      continue;
                    }

                    const existingPayments = await getPaymentsByInvoiceIds([targetResId]).catch(() => []);
                    const existingPaymentKeys = (existingPayments || []).map((ep) => ({
                      journalId: Array.isArray(ep.journal_id) ? ep.journal_id[0] : ep.journal_id,
                      amount: round2(ep.amount),
                    }));

                    const alreadyHasPayment = existingPaymentKeys.some(
                      (ep) => ep.journalId != null && ep.journalId === journalId && Math.abs(ep.amount - desiredAmount) <= 0.01
                    );

                    if (alreadyHasPayment) {
                      log('queue', `payment SO ${saleOrderId}: ${pm.type === 'check' ? 'cheque' : 'cash'} already reconciled — skip register amount=${desiredAmount} journal_id=${journalId} invoice=${targetResId}`);
                      continue;
                    }
                    try {
                      log('queue', `payment SO ${saleOrderId}: Step 5 — payment register create amount=${desiredAmount} journal_id=${journalId} active_ids=[${targetResId}]`);
                      const registerWizardId = await createPaymentRegisterWizard(targetResId, {
                        amount: desiredAmount,
                        journalId,
                        paymentDate: dateStr,
                      });
                      if (registerWizardId != null) {
                        log('queue', `payment SO ${saleOrderId}: Step 6 — action_create_payments [[${registerWizardId}]]`);
                        await executePaymentRegister(registerWizardId);
                        const methodLabel = pm.type === 'check' ? 'cheque' : 'cash';
                        log('queue', `payment SO ${saleOrderId}: ${methodLabel} payment executed wizard=${registerWizardId} invoice res_id=${targetResId}`);
                      }
                    } catch (registerErr) {
                      const msg = (registerErr?.message || String(registerErr)).toLowerCase();
                      const skipAsAlreadyPaid =
                        msg.includes('already') ||
                        msg.includes('reconciled') ||
                        msg.includes('nothing left to pay') ||
                        msg.includes('no payment registration') ||
                        msg.includes('nothing to pay') ||
                        msg.includes('finances under control');
                      if (skipAsAlreadyPaid) {
                        log('queue', `payment register skipped (invoice already paid or nothing to pay) invoice ${targetResId}`);
                      } else {
                        throw registerErr;
                      }
                    }
                  }
                  const regCheck = await verifyCashChequePaymentsRegisteredOnOdoo(soId, payments);
                  if (!regCheck.ok) {
                    invoiceBlockFailedNoItemsToInvoice = true;
                    log('queue', `payment SO ${soId} kept pending after register attempt — ${regCheck.reason}`);
                  } else {
                    await updatePaymentQueuePipeline(item.id, p, {
                      invoicePosted: true,
                      paymentsRegistered: true,
                    });
                    log('queue', `payment item ${item.id} invoice/payments confirmed on Odoo (chatter next)`);
                  }
                }
              }
            } catch (invoiceErr) {
              const msg = (invoiceErr?.message || String(invoiceErr)).toLowerCase();
              if (msg.includes('no items are available to invoice') || msg.includes('nothing to invoice')) {
                const heal = await attemptDeliveredQtyHealForSaleOrder(soId, p);
                if (heal.ok) {
                  const invRetry = await tryCreateAndPostDeliveredInvoice(soId);
                  if (invRetry.ok) {
                    postedInvoiceId = invRetry.resId;
                    log('queue', `payment SO ${soId}: invoice recovered after qty heal (res_id=${invRetry.resId})`);
                  } else {
                    invoiceBlockFailedNoItemsToInvoice = true;
                    logWarn(
                      'queue payment (invoice/payments)',
                      new Error(
                        `Invoice blocked after heal: ${String(invRetry.reason || 'nothing to invoice').slice(0, 120)}`
                      )
                    );
                  }
                } else {
                  invoiceBlockFailedNoItemsToInvoice = true;
                  logWarn(
                    'queue payment (invoice/payments)',
                    new Error(
                      'Invoice creation failed: delivered qty still mismatched on Odoo. Sync will retry automatically.'
                    )
                  );
                }
              } else if (msg.includes('must be in draft')) {
                log('queue', `payment SO ${saleOrderId}: invoice already posted (must be in draft) — retry verify on next pass`);
              } else {
                invoiceBlockFailedNoItemsToInvoice = true;
                logWarn('queue payment (invoice/payments)', invoiceErr);
              }
            }
          }

          const {
            buildPaymentProofMessageBody,
            buildSinglePaymentMessageBody,
            createProofAttachment,
            postPaymentProofToChatterWithAttachmentIds,
            imageFileToBase64String,
          } = await import('./proofAttachment.service.js');
          const hasCheck = payments.some((pm) => pm.type === 'check');
          const hasCash = payments.some((pm) => pm.type === 'cash');
          const hasCredit = payments.some((pm) => pm.type === 'credit');
          const paymentMethod = hasCheck ? 'cheque' : hasCash ? 'cash' : hasCredit ? 'credit' : undefined;
          const chequeBankName = p.chequeBankName || (hasCheck && (p.selectedBankName || '—'));
          const chequeNumber = p.checkNumber || (payments.find((pm) => pm.type === 'check')?.checkNumber);
          const paymentsForMessage = payments.map((pm) => ({
            type: pm.type,
            amount: Number(pm.amount) || 0,
            checkNumber: pm.type === 'check' ? (pm.checkNumber || chequeNumber) : undefined,
            bankName: pm.type === 'check' ? chequeBankName : undefined,
          }));
          const isPartialPayment = paymentsForMessage.length > 1;
          /** Separate sale.order chatter (not appended to payment proof). */
          const buildGasDeliveredCountMessageBody = async () => {
            const raw = Array.isArray(p?.invoiceLineQtys) ? p.invoiceLineQtys : [];
            const entries = raw
              .map((x) => ({
                lineId: Number(x?.lineId),
                qty: Number(x?.qty),
              }))
              .filter((x) => Number.isFinite(x.lineId) && x.lineId > 0 && Number.isFinite(x.qty) && x.qty > 0);
            if (!entries.length) return null;

            const orderLines = await saleOrderLinesDb.getSaleOrderLinesByOrderIds([soId]).catch(() => []);
            const lineById = new Map(
              (orderLines || [])
                .filter((l) => l?.id != null)
                .map((l) => [Number(l.id), l])
            );

            const qtyByProductLabel = new Map();
            const formatQty = (q) => {
              const n = Number(q) || 0;
              const s = n.toFixed(3).replace(/\.?0+$/, '');
              return s === '' ? '0' : s;
            };

            for (const it of entries) {
              const line = lineById.get(it.lineId);
              const productName =
                (line?.product_name && String(line.product_name).trim()) ||
                (line?.name && String(line.name).trim()) ||
                `Line ${it.lineId}`;
              const prev = Number(qtyByProductLabel.get(productName)) || 0;
              qtyByProductLabel.set(productName, prev + Number(it.qty));
            }
            if (qtyByProductLabel.size === 0) return null;

            const sep = '────────────────────────────────────────';
            const lines = [];
            lines.push('Gas Delivered Count');
            lines.push(sep);
            for (const [label, qty] of qtyByProductLabel.entries()) {
              lines.push(`${label}: ${formatQty(qty)}`);
            }
            return lines.join('\n');
          };
          const gasDeliveredCountBody = await buildGasDeliveredCountMessageBody().catch(() => null);
          const invoicePendingNote = invoiceBlockFailedNoItemsToInvoice
            ? '\n\n— Invoice / delivery not fully synced in Odoo yet; confirm quantities in the office if needed. Payment proof is attached above. —'
            : '';

          if (chatterPostedInThisRun.has(soId)) {
            if (invoiceBlockFailedNoItemsToInvoice) {
              log('queue', `payment SO ${soId}: chatter done but invoice incomplete — keep pending`);
              continue;
            }
            if (await markPaymentQueueItemSyncedWhenBackendComplete(item, soId, p)) {
              alreadySyncedSaleOrderIds.add(soId);
              log('queue', `payment synced id=${item.id} (chatter already posted for SO ${soId})`);
            }
            continue;
          }

          const pipelineReadyForChatter =
            !invoiceBlockFailedNoItemsToInvoice && (await paymentPipelineReadyForChatter(soId, p));

          if (!p._paymentProofChatterPosted && !pipelineReadyForChatter) {
            log('queue', `payment SO ${soId}: skip chatter until delivery/invoice/payment fully confirmed on Odoo`);
          } else if (!p._paymentProofChatterPosted) {
            const offlineAttachmentsDb = await import('../database/offlineAttachments.js');
            const pendingAttachments = await offlineAttachmentsDb.getPendingBySaleOrderId(soId);
            const FileSystem = await import('expo-file-system');

            if (!(Number.isFinite(Number(postedInvoiceId)) && Number(postedInvoiceId) > 0)) {
              try {
                const maybeIds = normalizeSaleOrderInvoiceIds(await getSaleOrderInvoiceIds(soId));
                if (maybeIds.length > 0) {
                  postedInvoiceId = Number(maybeIds[0]);
                }
              } catch (_) {
                postedInvoiceId = null;
              }
            }

            const attachmentIds = [];
            const syncedAttachmentIds = [];
            const pendingCount = (pendingAttachments || []).length;

            // Doc: read pending URIs from offline_attachments → base64 → ir.attachment.create → collect ids → message_post(attachment_ids).
            log('queue', `payment proof (SO ${soId}): ${pendingCount} pending in offline_attachments — URI→base64→create→message_post`);

            for (const att of pendingAttachments || []) {
              if (!att.local_file_path || !att.file_name) continue;
              try {
                const file = new FileSystem.File(att.local_file_path);
                if (!file.exists) {
                  await offlineAttachmentsDb.markFailed(Number(att.id), `File missing: ${att.local_file_path}`);
                  logWarn('queue payment proof', new Error('File missing'));
                  continue;
                }
                const normalized = await imageFileToBase64String(FileSystem, att.local_file_path);
                if (!normalized) {
                  await offlineAttachmentsDb.markFailed(Number(att.id), 'Invalid or too short base64');
                  logWarn('queue payment proof', new Error('Invalid base64'));
                  continue;
                }
                const aid = await createProofAttachment(soId, normalized, att.file_name);
                attachmentIds.push(aid);
                syncedAttachmentIds.push(att.id);
                log('queue', `ir.attachment.create SO ${soId} → attachment_id=${aid}`);
              } catch (attErr) {
                await offlineAttachmentsDb.incrementRetry(att.id, attErr?.message || 'Upload error');
                logWarn('queue payment proof attachment', attErr);
              }
            }

            if (pendingCount > 0 && attachmentIds.length === 0) {
              logWarn(
                'queue payment proof',
                new Error(
                  'Pending proof photos could not be uploaded (missing file or API error). Posting chatter without attachments so invoice/payment still completes; attachments stay pending for retry.'
                )
              );
              // Do not continue: previously this left the queue item unsynced forever even when Odoo already had the payment.
            }

            // Auto-attach printed invoice PDF from Odoo report when order is completed and payment sync runs.
            if (Number.isFinite(Number(postedInvoiceId)) && Number(postedInvoiceId) > 0) {
              const invoicePdfAttachmentId = await tryAttachPrintedInvoicePdfToSaleOrder(
                soId,
                Number(postedInvoiceId),
                orderName
              );
              if (invoicePdfAttachmentId != null) {
                attachmentIds.push(Number(invoicePdfAttachmentId));
                log('queue', `invoice PDF attached for SO ${soId} from invoice ${postedInvoiceId}`);
              }
            }

            const hasProof = attachmentIds.length > 0;

            // API 2: Post message(s) to sale order chatter. Partial payment = one message per payment type.
            try {
              if (isPartialPayment && paymentsForMessage.length > 0) {
                log('queue', `message_post API (sale.order) SO ${soId} — ${paymentsForMessage.length} separate messages (Cash/Cheque/Credit)`);
                for (let i = 0; i < paymentsForMessage.length; i++) {
                  const pm = paymentsForMessage[i];
                  const attachToThisMessage = i === 0 ? attachmentIds : [];
                  const body =
                    buildSinglePaymentMessageBody(pm, { hasProof: attachToThisMessage.length > 0 }) +
                    (i === 0 ? invoicePendingNote : '');
                  await postPaymentProofToChatterWithAttachmentIds(soId, { body, attachmentIds: attachToThisMessage });
                  if (attachToThisMessage.length > 0) {
                    const pendingById = new Map((pendingAttachments || []).map((a) => [Number(a.id), a]));
                    for (const id of syncedAttachmentIds) {
                      const idNum = Number(id);
                      await offlineAttachmentsDb.markSynced(idNum);
                      const att = pendingById.get(idNum);
                      if (att?.local_file_path) {
                        try {
                          const fileToDelete = new FileSystem.File(att.local_file_path);
                          if (fileToDelete.exists) fileToDelete.delete();
                        } catch (_) { }
                      }
                    }
                  }
                }
              } else {
                log('queue', `message_post API (sale.order) SO ${soId} attachment_ids=[${attachmentIds.join(', ')}]`);
                const body =
                  buildPaymentProofMessageBody({
                    paymentMethod,
                    chequeBankName: paymentMethod === 'cheque' ? chequeBankName : undefined,
                    checkNumber: paymentMethod === 'cheque' ? (chequeNumber || undefined) : undefined,
                    payments: paymentsForMessage,
                    hasProof,
                  }) + invoicePendingNote;
                await postPaymentProofToChatterWithAttachmentIds(soId, { body, attachmentIds });
                if (attachmentIds.length > 0) {
                  const pendingById = new Map((pendingAttachments || []).map((a) => [Number(a.id), a]));
                  for (const id of syncedAttachmentIds) {
                    const idNum = Number(id);
                    await offlineAttachmentsDb.markSynced(idNum);
                    const att = pendingById.get(idNum);
                    if (att?.local_file_path) {
                      try {
                        const fileToDelete = new FileSystem.File(att.local_file_path);
                        if (fileToDelete.exists) fileToDelete.delete();
                      } catch (_) { }
                    }
                  }
                }
              }
              if (gasDeliveredCountBody && !p._paymentProofGasChatterPosted) {
                try {
                  await postPaymentProofToChatterWithAttachmentIds(soId, {
                    body: gasDeliveredCountBody,
                    attachmentIds: [],
                  });
                  log('queue', `message_post Gas Delivered Count SO ${soId}`);
                  p._paymentProofGasChatterPosted = true;
                } catch (gasDelErr) {
                  logWarn('queue payment gas-delivered chatter', gasDelErr);
                }
              }
              const emptyCylinderNote = (p.emptyCylinderChatterBody || p.emptyCylinderChatterNote || '').trim();
              if (emptyCylinderNote && !p._paymentProofEmptyCylinderChatterPosted) {
                try {
                  await postPaymentProofToChatterWithAttachmentIds(soId, {
                    body: emptyCylinderNote,
                    attachmentIds: [],
                  });
                  log('queue', `empty cylinder note message_post SO ${soId}`);
                  p._paymentProofEmptyCylinderChatterPosted = true;
                } catch (emptyChatterErr) {
                  logWarn('queue payment empty-cylinder chatter', emptyChatterErr);
                }
              }

              chatterPostedInThisRun.add(soId);
              log('queue', `chatter posted to SO ${soId}${isPartialPayment ? ` (${paymentsForMessage.length} messages)` : ` (${attachmentIds.length} images)`}`);
              try {
                await syncQueueDb.updateQueueItemPayload(item.id, {
                  ...(item.payload || {}),
                  _paymentProofChatterPosted: true,
                  _paymentProofGasChatterPosted: !!p._paymentProofGasChatterPosted,
                  _paymentProofEmptyCylinderChatterPosted: !!p._paymentProofEmptyCylinderChatterPosted,
                });
              } catch (upErr) {
                logWarn('queue payment _paymentProofChatterPosted', upErr);
              }
            } catch (chatterErr) {
              for (const id of syncedAttachmentIds) {
                await offlineAttachmentsDb.incrementRetry(Number(id), chatterErr?.message || 'API error');
              }
              logWarn('queue payment chatter', chatterErr);
              continue;
            }
          } else {
            log(
              'queue',
              `payment SO ${soId}: skipping duplicate payment-proof chatter (already posted; retrying invoice/payment only)`
            );
          }

          if (invoiceBlockFailedNoItemsToInvoice) {
            const heal = await attemptDeliveredQtyHealForSaleOrder(soId, p);
            if (heal.ok) {
              const invRetry = await tryCreateAndPostDeliveredInvoice(soId);
              if (invRetry.ok) {
                invoiceBlockFailedNoItemsToInvoice = false;
                postedInvoiceId = invRetry.resId;
                log('queue', `payment SO ${soId}: invoice created after delivered qty heal (res_id=${invRetry.resId})`);
              } else {
                log(
                  'queue',
                  `payment SO ${soId}: heal OK but invoice retry failed — ${String(invRetry.reason || '').slice(0, 100)}`
                );
              }
            }
          }
          if (invoiceBlockFailedNoItemsToInvoice) {
            log('queue', `payment item ${item.id} NOT marked synced (invoice not created — deliver first, then sync again for cheque/credit)`);
            continue;
          }
          if (await markPaymentQueueItemSyncedWhenBackendComplete(item, soId, p)) {
            alreadySyncedSaleOrderIds.add(soId);
            log('queue', `payment synced id=${item.id}`);
          }
        } catch (e) {
          logWarn('queue payment', e);
        }
      }
        } catch (passErr) {
          logWarn('queue pass', passErr);
        }

        const pendingAfter = await syncQueueDb.getPendingCount();
        if (pendingAfter === 0) break;
        if (lastPending >= 0 && pendingAfter < lastPending) {
          lastPending = pendingAfter;
          if (pendingAfter > 0) {
            await new Promise((r) => setTimeout(r, QUEUE_SYNC_FAST_PASS_DELAY_MS));
          }
        } else if (pendingAfter === lastPending) {
          await new Promise((r) => setTimeout(r, QUEUE_SYNC_RETRY_PASS_DELAY_MS));
          lastPending = pendingAfter;
        } else {
          lastPending = pendingAfter;
        }
      }
      if (pass > 1) {
        const left = await syncQueueDb.getPendingCount();
        log('queue', `retry window finished after ${pass} pass(es), pending=${left}`);
      }
    } finally {
      try {
        const { pruneStaleCheckoutResumeEntries } = await import('./checkoutResume.service.js');
        await pruneStaleCheckoutResumeEntries();
      } catch (_) {
        /* ignore */
      }
      _processSyncQueuePromise = null;
    }
  })();
  return _processSyncQueuePromise;
}

/**
 * Upload standalone evidence photos that were saved locally after the payment queue item already synced.
 * This keeps invoice evidence from getting stranded in offline_attachments when the user revisits the flow.
 */
async function processStandaloneOfflineAttachments() {
  const offlineAttachmentsDb = await import('../database/offlineAttachments.js');
  const pendingAttachments = await offlineAttachmentsDb.getAllPending();
  if (!pendingAttachments.length) return;

  const grouped = new Map();
  for (const att of pendingAttachments) {
    const saleOrderId = Number(att.sale_order_id);
    if (!Number.isFinite(saleOrderId)) continue;
    if (!grouped.has(saleOrderId)) grouped.set(saleOrderId, []);
    grouped.get(saleOrderId).push(att);
  }
  if (!grouped.size) return;

  const { getPendingPaymentItemBySaleOrderId } = syncQueueDb;
  const FileSystem = await import('expo-file-system');
  const {
    createProofAttachment,
    postPaymentProofToChatterWithAttachmentIds,
    imageFileToBase64String,
  } = await import('./proofAttachment.service.js');

  for (const [saleOrderId, attachments] of grouped.entries()) {
    // Keep queue-driven payment uploads authoritative. Standalone evidence is only pushed once
    // there is no pending payment queue item left for the sale order.
    const pendingPaymentItem = await getPendingPaymentItemBySaleOrderId(saleOrderId);
    if (pendingPaymentItem) continue;

    const attachmentIds = [];
    const syncedAttachmentIds = [];
    log('queue', `standalone evidence (SO ${saleOrderId}): ${attachments.length} pending`);

    for (const att of attachments) {
      if (!att.local_file_path || !att.file_name) continue;
      try {
        const file = new FileSystem.File(att.local_file_path);
        if (!file.exists) {
          await offlineAttachmentsDb.markFailed(Number(att.id), `File missing: ${att.local_file_path}`);
          continue;
        }
        const normalized = await imageFileToBase64String(FileSystem, att.local_file_path);
        if (!normalized) {
          await offlineAttachmentsDb.markFailed(Number(att.id), 'Invalid or too short base64');
          continue;
        }
        const aid = await createProofAttachment(saleOrderId, normalized, att.file_name);
        attachmentIds.push(aid);
        syncedAttachmentIds.push(att.id);
      } catch (attErr) {
        await offlineAttachmentsDb.incrementRetry(att.id, attErr?.message || 'Upload error');
        logWarn('standalone evidence attachment', attErr);
      }
    }

    if (!attachmentIds.length) continue;

    try {
      await postPaymentProofToChatterWithAttachmentIds(saleOrderId, {
        body: 'Delivery evidence photo(s) uploaded.',
        attachmentIds,
      });
      const pendingById = new Map(attachments.map((a) => [Number(a.id), a]));
      for (const id of syncedAttachmentIds) {
        const idNum = Number(id);
        await offlineAttachmentsDb.markSynced(idNum);
        const att = pendingById.get(idNum);
        if (att?.local_file_path) {
          try {
            const fileToDelete = new FileSystem.File(att.local_file_path);
            if (fileToDelete.exists) fileToDelete.delete();
          } catch (_) { }
        }
      }
      log('queue', `standalone evidence posted to SO ${saleOrderId} (${attachmentIds.length} images)`);
    } catch (e) {
      for (const id of syncedAttachmentIds) {
        await offlineAttachmentsDb.incrementRetry(Number(id), e?.message || 'API error');
      }
      logWarn('standalone evidence chatter', e);
    }
  }
}

/**
 * Delete all local synced data from SQLite (partners, orders, pickings, etc.)
 * and clear last-sync state. Does not remove user session.
 * After this, running Sync again will repopulate from Odoo.
 *
 * @param {{ discardUnsynced?: boolean }} [options] — If false (default), blocks when sync_queue or
 *   pending attachments exist so Odoo is not missing mobile-only actions. Set true only after user
 *   confirms they accept losing unsynced deliveries/payments/chatter uploads.
 */
export async function deleteLocalData(options = {}) {
  const discardUnsynced = options.discardUnsynced === true;
  const { getDb } = await import('../database/db.js');
  const db = await getDb();
  const pendingQueueCount = await syncQueueDb.getPendingCount();
  const pendingAttachmentRow = await db.getFirstAsync(
    `SELECT COUNT(*) as c FROM offline_attachments WHERE sync_status = 'pending'`
  );
  const pendingAttachmentCount = pendingAttachmentRow?.c ?? 0;

  if (!discardUnsynced && (pendingQueueCount > 0 || pendingAttachmentCount > 0)) {
    const err = new Error(
      `Cannot clear local data while pending sync exists (sync_queue=${pendingQueueCount}, attachments=${pendingAttachmentCount}). Sync pending items first.`
    );
    err.code = 'PENDING_SYNC';
    err.pendingQueueCount = pendingQueueCount;
    err.pendingAttachmentCount = pendingAttachmentCount;
    throw err;
  }

  const tables = [
    'partners',
    'sale_orders',
    'sale_order_lines',
    'products',
    'stock_pickings',
    'stock_moves',
    'stock_move_lines',
    'account_journals',
    'routes',
    'vehicles',
    'vehicle_warehouses',
    'vehicle_inventories',
    'offline_attachments',
    'local_payments',
    'local_invoices',
    'sync_log',
    'sync_queue',
  ];
  await db.withTransactionAsync(async (rawDb) => {
    for (const table of tables) {
      await rawDb.runAsync(`DELETE FROM ${table}`);
    }
  });
  const storage = await getAsyncStorage();
  await storage.multiRemove([KEYS.LAST_SYNC, ...TRANSLATION_STORAGE_KEYS]);
  log('deleteLocalData', 'all synced data cleared');
}

export function getSyncIntervalMs(syncInterval = '5min') {
  return SYNC_INTERVAL_MAP[syncInterval] ?? SYNC_INTERVAL_MAP['5min'];
}

export function getSyncIntervalMinutes(syncInterval = '5min') {
  return getSyncIntervalMs(syncInterval) / 60000;
}

// Helper function to compute cutoff date based on sync period setting
async function getCutoffDateForSync() {
  try {
    const storage = await getAsyncStorage();
    const rawSyncPeriod = await storage.getItem(KEYS.SYNC_PERIOD);
    const syncPeriod = rawSyncPeriod === '3days' ? '7days' : (rawSyncPeriod || '7days');

    const now = new Date();
    let cutoffDate = new Date(now);

    switch (syncPeriod) {
      case '7days':
        cutoffDate.setDate(now.getDate() - 7);
        break;
      case '30days':
        cutoffDate.setDate(now.getDate() - 30);
        break;
      case '90days':
        cutoffDate.setDate(now.getDate() - 90);
        break;
      case '1year':
        cutoffDate.setFullYear(now.getFullYear() - 1);
        break;
      case 'all':
      default:
        return null; // No date filter for 'all'
    }

    // Return ISO date string (YYYY-MM-DD)
    return cutoffDate.toISOString().split('T')[0];
  } catch (_) {
    return null; // Default to no filter on error
  }
}

async function getSyncDateFieldSetting() {
  try {
    const storage = await getAsyncStorage();
    const raw = await storage.getItem(KEYS.SYNC_DATE_FIELD);
    return raw === 'delivery_date' ? 'delivery_date' : 'creation_date';
  } catch (_) {
    return 'creation_date';
  }
}

// ---------- Sync: pull from Odoo and store in SQLite ----------

async function runSyncInternal() {
  if (_syncStateListener) _syncStateListener(true);
  log('start', new Date().toISOString());
  const result = { customers: 0, orders: 0, orderLines: 0, pickings: 0, moves: 0, moveLines: 0, journals: 0, routes: 0, vehicles: 0, vehicleWarehouses: 0, vehicleInventories: 0, error: null };
  const syncAt = new Date().toISOString();
  log('start', syncAt);

  try {
    if (isLoggingOut) {
      log('stop', 'logout in progress');
      return { error: 'Logout in progress' };
    }
    const session = await getUserSession();
    if (!session) {
      log('stop', 'no active session');
      return { error: 'No active session' };
    }
    await processSyncQueue();
    await processStandaloneOfflineAttachments();

    const user = await getUserSession();
    // Vehicle-scoped sync: when user has vehicleId and is not admin, sync only that vehicle's data.
    const vehicleId = (user?.vehicleId != null && user?.isAdmin !== true) ? user.vehicleId : null;

    // Get sync period + selected date field (creation or delivery date)
    const [dateFromFilter, syncDateField] = await Promise.all([
      getCutoffDateForSync(),
      getSyncDateFieldSetting(),
    ]);
    const syncDateFieldLabel = syncDateField === 'delivery_date' ? 'commitment_date' : 'date_order';
    if (dateFromFilter) {
      log('sync', `using date filter: ${dateFromFilter} field=${syncDateFieldLabel}`);
    }

    let orders = [];
    let customers = [];
    let orderFetchFailed = false;
    let orderFetchError = null;

    if (vehicleId != null) {
      log('fetch', `orders for vehicle ${vehicleId} only`);
      orders = await getSaleOrdersByVehicle(vehicleId, dateFromFilter, syncDateField).catch((e) => {
        orderFetchFailed = true;
        orderFetchError = e?.message || String(e || 'Order sync failed');
        logWarn('fetch orders by vehicle', e);
        return [];
      });
      const partnerIds = [...new Set((orders || []).map((o) => (Array.isArray(o.partner_id) ? o.partner_id[0] : o.partner_id)).filter(Boolean))];
      log('fetch', `partners for vehicle (${partnerIds.length} ids)`);
      customers = await getPartnersByIds(partnerIds).catch((e) => {
        logWarn('fetch partners by ids', e);
        return [];
      });
    } else {
      log('fetch', 'customers + orders (full sync)');
      [customers, orders] = await Promise.all([
        getCustomers().catch((e) => {
          logWarn('fetch customers', e);
          return [];
        }),
        getAllSaleOrders(dateFromFilter, syncDateField).catch((e) => {
          orderFetchFailed = true;
          orderFetchError = e?.message || String(e || 'Order sync failed');
          logWarn('fetch orders', e);
          return [];
        }),
      ]);
    }

    result.customers = (customers || []).length;
    // Keep all fetched orders in local DB.
    // In delivery-date mode, UI reads commitment_date first and falls back to date_order
    // so offline-completed orders do not disappear when commitment_date is missing.
    result.orders = (orders || []).length;
    log('fetch', `customers=${result.customers} orders=${result.orders}`);
    if (orderFetchFailed) {
      const err = orderFetchError || 'Order sync failed';
      result.error = err;
      throw new Error(err);
    }
    if (isLoggingOut) return { error: 'Logout in progress' };
    // Dashboard and order lists read from local DB only; preserve local state for orders with pending upload.
    const pendingSaleOrderIds = await syncQueueDb.getPendingSaleOrderIds();
    const syncedPaymentSaleOrderIds = await syncQueueDb.getSyncedPaymentSaleOrderIds();
    const localInvoicesMod = await import('../database/localInvoices.js');
    const unsyncedInvoiceSoIds = await localInvoicesMod.getUnsyncedLocalInvoiceSaleOrderIds();
    const fetchedOrderIds = (orders || []).map((o) => o?.id).filter((id) => id != null).map((id) => Number(id));
    const fetchedOrderIdSet = new Set(fetchedOrderIds);
    const preserveLocalSaleOrderIds = new Set(pendingSaleOrderIds);
    for (const soId of syncedPaymentSaleOrderIds) {
      const idNum = Number(soId);
      if (Number.isFinite(idNum) && fetchedOrderIdSet.has(idNum)) {
        preserveLocalSaleOrderIds.add(idNum);
      }
    }
    for (const soId of unsyncedInvoiceSoIds) {
      const idNum = Number(soId);
      if (Number.isFinite(idNum) && idNum > 0 && fetchedOrderIdSet.has(idNum)) {
        preserveLocalSaleOrderIds.add(idNum);
      }
    }

    /** Do not skip Odoo payment split refresh for SOs that only have a synced mobile payment — otherwise Cash/Cheque/Credit tabs stay wrong. */
    const paymentRefreshSkipIds = new Set();
    for (const id of pendingSaleOrderIds) {
      const n = Number(id);
      if (Number.isFinite(n)) paymentRefreshSkipIds.add(n);
    }
    for (const soId of unsyncedInvoiceSoIds) {
      const idNum = Number(soId);
      if (Number.isFinite(idNum) && idNum > 0) paymentRefreshSkipIds.add(idNum);
    }

    // Remove stale local orders only when order fetch is healthy and non-empty.
    // This prevents accidental local wipe if backend temporarily returns empty/error.
    if (!orderFetchFailed && fetchedOrderIds.length > 0) {
      await saleOrdersDb.pruneSaleOrdersToIds(fetchedOrderIds, { preserveLocalForSaleOrderIds: preserveLocalSaleOrderIds });
    } else {
      log('sync', `skip local prune (orderFetchFailed=${orderFetchFailed}, fetchedOrders=${fetchedOrderIds.length})`);
    }

    log('db', 'partners');
    await partnersDb.upsertPartners(customers || []);
    log('db', 'sale_orders');
    await saleOrdersDb.upsertSaleOrders(orders || [], { preserveLocalForSaleOrderIds: preserveLocalSaleOrderIds });

    await refreshPaymentTypesFromOdoo(orders || [], { skipOrderIds: paymentRefreshSkipIds });

    const orderIds = (orders || []).map((o) => o.id);
    let allLines = [];
    let allPickings = [];
    let allMoves = [];
    let allMoveLines = [];
    const productIds = new Set();

    const { callOdoo } = await import('./index.service');

    if (orderIds.length > 0) {
      const lineIds = [];
      (orders || []).forEach((o) => {
        (o.order_line || []).forEach((entry) => {
          const id = Array.isArray(entry) ? entry[0] : entry;
          if (id != null) lineIds.push(id);
        });
      });
      if (lineIds.length > 0) {
        log('fetch', `order lines (${lineIds.length} ids)`);
        const lines = await callOdoo(
          'sale.order.line',
          'search_read',
          [[['id', 'in', lineIds]]],
          {
            fields: [
              'id',
              'order_id',
              'product_id',
              'name',
              'product_uom_qty',
              'qty_delivered',
              'price_unit',
              'price_subtotal',
              'price_total',
            ],
            limit: 1000,
          }
        );
        allLines = lines || [];
        result.orderLines = allLines.length;
        allLines.forEach((l) => {
          const pid = Array.isArray(l.product_id) ? l.product_id[0] : l.product_id;
          if (pid) productIds.add(pid);
        });
        log('fetch', `orderLines=${result.orderLines}`);
      }

      log('fetch', 'stock.picking');
      allPickings = await callOdoo(
        'stock.picking',
        'search_read',
        [[['sale_id', 'in', orderIds]]],
        { fields: ['id', 'name', 'sale_id', 'state', 'move_ids', 'backorder_ids'], limit: 500 }
      ) || [];
      result.pickings = allPickings.length;
      log('fetch', `pickings=${result.pickings}`);

      const pickingIds = (allPickings || []).map((p) => Number(p?.id)).filter((id) => Number.isFinite(id));
      const pickBatchSize = 40;
      for (let i = 0; i < pickingIds.length; i += pickBatchSize) {
        const batch = pickingIds.slice(i, i + pickBatchSize);
        if (!batch.length) continue;
        const batchMoves = await callOdoo(
          'stock.move',
          'search_read',
          [[['picking_id', 'in', batch]]],
          { fields: ['id', 'picking_id', 'product_uom_qty', 'product_id', 'state'], limit: 5000 }
        );
        (batchMoves || []).forEach((m) => {
          const pickingId = Array.isArray(m.picking_id) ? Number(m.picking_id[0]) : Number(m.picking_id);
          allMoves.push({ ...m, picking_id: Number.isFinite(pickingId) ? pickingId : m.picking_id });
          const pid = Array.isArray(m.product_id) ? m.product_id[0] : m.product_id;
          if (pid) productIds.add(pid);
        });
      }

      const moveIds = (allMoves || []).map((m) => Number(m?.id)).filter((id) => Number.isFinite(id));
      const moveBatchSize = 200;
      for (let i = 0; i < moveIds.length; i += moveBatchSize) {
        const batch = moveIds.slice(i, i + moveBatchSize);
        if (!batch.length) continue;
        const batchMoveLines = await callOdoo(
          'stock.move.line',
          'search_read',
          [[['move_id', 'in', batch]]],
          { fields: ['id', 'move_id', 'qty_done'], limit: 5000 }
        );
        (batchMoveLines || []).forEach((ml) => allMoveLines.push(ml));
      }
      result.moves = allMoves.length;
      result.moveLines = allMoveLines.length;
      log('fetch', `moves=${result.moves} moveLines=${result.moveLines}`);
    }

    log('db', 'sale_order_lines');
    await saleOrderLinesDb.upsertSaleOrderLines(allLines, {
      preserveQtyForOrderIds: preserveLocalSaleOrderIds,
    });
    log('db', 'stock_pickings');
    await stockPickingsDb.upsertStockPickings(allPickings, { preserveLocalStateForSaleOrderIds: pendingSaleOrderIds });
    log('db', 'stock_moves');
    await stockMovesDb.upsertStockMoves(allMoves);
    log('db', 'stock_move_lines');
    await stockMoveLinesDb.upsertStockMoveLines(allMoveLines);
    // Prefer product rows referenced by fetched orders/moves to keep sync fast.
    // Fallback to full catalog only when targeted fetch returns empty.
    try {
      const ids = Array.from(productIds);
      let products = [];
      if (ids.length > 0) {
        log('fetch', `product.product (targeted by ids: ${ids.length})`);
        products = await getProductsByIds(ids);
      }
      if (!products?.length) {
        log('fetch', 'product.product (full catalog fallback)');
        products = await getAllProducts();
      }
      try {
        const mandatoryEmpty = await getMandatoryEmptyCylinderProducts([2.4, 5, 12.5, 37.5]);
        if (mandatoryEmpty?.length) {
          const byId = new Map();
          for (const p of products || []) {
            if (p?.id != null) byId.set(Number(p.id), p);
          }
          for (const p of mandatoryEmpty) {
            if (p?.id != null) byId.set(Number(p.id), p);
          }
          products = Array.from(byId.values());
          log('fetch', `mandatory empty products merged (${mandatoryEmpty.length})`);
        }
      } catch (emptyErr) {
        logWarn('fetch mandatory empty products', emptyErr);
      }
      if (products?.length) {
        log('db', `products (${products.length})`);
        await productsDb.upsertProducts(products);
      } else if (ids.length > 0) {
        await productsDb.upsertProducts(ids.map((id) => ({ id, name: null })));
      }
    } catch (e) {
      logWarn('fetch products', e);
      if (productIds.size > 0) {
        const ids = Array.from(productIds);
        await productsDb.upsertProducts(ids.map((id) => ({ id, name: null })));
      }
    }

    // When vehicle-scoped: fetch only journals + routes + single vehicle. Otherwise full list.
    log('fetch', vehicleId != null ? 'journals + routes + current vehicle' : 'journals + routes + vehicles');
    let vehiclesList;
    if (vehicleId != null) {
      const [journals, routes, singleVehicle] = await Promise.all([
        getJournals().catch((e) => {
          logWarn('fetch journals', e);
          return [];
        }),
        getRoutes().catch((e) => {
          logWarn('fetch routes', e);
          return [];
        }),
        getVehicleById(vehicleId).catch((e) => {
          logWarn('fetch vehicle by id', e);
          return null;
        }),
      ]);
      result.journals = (journals || []).length;
      result.routes = (routes || []).length;
      vehiclesList = singleVehicle ? [singleVehicle] : [];
      result.vehicles = vehiclesList.length;
      log('db', 'journals + routes + vehicles');
      await journalsDb.upsertJournals(journals || []);
      await routesDb.upsertRoutes(routes || []);
      await vehiclesDb.upsertVehicles(vehiclesList);
    } else {
      const [journals, routes, vehicles] = await Promise.all([
        getJournals().catch((e) => {
          logWarn('fetch journals', e);
          return [];
        }),
        getRoutes().catch((e) => {
          logWarn('fetch routes', e);
          return [];
        }),
        getVehicles().catch((e) => {
          logWarn('fetch vehicles', e);
          return [];
        }),
      ]);
      result.journals = (journals || []).length;
      result.routes = (routes || []).length;
      result.vehicles = (vehicles || []).length;
      vehiclesList = vehicles || [];
      log('db', 'journals + routes + vehicles');
      await journalsDb.upsertJournals(journals || []);
      await routesDb.upsertRoutes(routes || []);
      await vehiclesDb.upsertVehicles(vehiclesList);
    }

    const allVehicleWarehouses = [];
    const allVehicleInventories = [];
    const vehiclesToFetchInventory = vehiclesList;
    const normalizeKey = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const stockWarehouses = await getStockWarehouses().catch((e) => {
      logWarn('fetch stock warehouses', e);
      return [];
    });
    const warehouseByNameKey = new Map();
    const warehouseByCodeKey = new Map();
    for (const wh of stockWarehouses || []) {
      const nameKey = normalizeKey(wh?.name);
      const codeKey = normalizeKey(wh?.code);
      if (nameKey && !warehouseByNameKey.has(nameKey)) warehouseByNameKey.set(nameKey, wh);
      if (codeKey && !warehouseByCodeKey.has(codeKey)) warehouseByCodeKey.set(codeKey, wh);
    }
    for (const v of vehiclesToFetchInventory) {
      const vId = v.id;
      const licensePlate = v.license_plate || (v.name || '').split('/').pop() || '';
      if (!licensePlate) continue;
      try {
        log('fetch', `vehicle warehouse ${licensePlate}`);
        const plateKey = normalizeKey(licensePlate);
        const vehicleNameKey = normalizeKey(v?.name);
        const afterHyphen = String(licensePlate).split('-').pop() || '';
        const codeKey = normalizeKey(afterHyphen);
        let resolvedLocationId = null;
        let resolvedLocationName = '';
        let resolvedLocationCompleteName = '';

        const matchedWarehouse =
          warehouseByNameKey.get(plateKey) ||
          warehouseByNameKey.get(vehicleNameKey) ||
          warehouseByCodeKey.get(codeKey) ||
          null;
        if (matchedWarehouse?.lot_stock_id != null) {
          const lot = matchedWarehouse.lot_stock_id;
          const lotId = Array.isArray(lot) ? Number(lot[0]) : Number(lot);
          const lotName = Array.isArray(lot) ? String(lot[1] || '') : '';
          if (Number.isFinite(lotId) && lotId > 0) {
            resolvedLocationId = lotId;
            resolvedLocationName = lotName || String(matchedWarehouse?.name || '');
            resolvedLocationCompleteName = lotName || String(matchedWarehouse?.name || '');
          }
        }

        if (resolvedLocationId == null) {
          const locations = await getStockLocationByVehicle(licensePlate).catch(() => []);
          const loc = locations && locations[0] ? locations[0] : null;
          if (loc?.id != null) {
            resolvedLocationId = Number(loc.id);
            resolvedLocationName = String(loc.name || '');
            resolvedLocationCompleteName = String(loc.complete_name || loc.name || '');
          }
        }

        if (resolvedLocationId != null) {
          allVehicleWarehouses.push({
            id: resolvedLocationId,
            vehicle_id: vId,
            name: resolvedLocationName,
            complete_name: resolvedLocationCompleteName,
          });
          log('fetch', `vehicle inventory location ${resolvedLocationId}  ${vId}`);
          let quants = [];
          let inventoryFetchOk = false;
          try {
            quants = await getVehicleInventoryByLocation(resolvedLocationId);
            inventoryFetchOk = true;
          } catch (invErr) {
            inventoryFetchOk = false;
            logWarn(`vehicle inventory fetch location ${resolvedLocationId}`, invErr);
          }
          const inventoryRowsForLocation = (quants || []).map((q) => ({
            ...q,
            location_id: resolvedLocationId,
            vehicle_id: vId,
          }));
          allVehicleInventories.push(...inventoryRowsForLocation);
          if (inventoryFetchOk) {
            await vehicleInventoriesDb.pruneInventoryForLocationToIds(
              resolvedLocationId,
              inventoryRowsForLocation.map((r) => r.id)
            );
            if (inventoryRowsForLocation.length > 0) {
              await vehicleInventoriesDb.upsertVehicleInventories(inventoryRowsForLocation);
            } else {
              log('sync', `vehicle inventory location ${resolvedLocationId}: synced empty quants (stock now zero where applicable)`);
            }
          } else {
            log('sync', `vehicle inventory location ${resolvedLocationId}: fetch failed, keep existing local rows`);
          }
        }
      } catch (e) {
        logWarn(`vehicle ${vId} warehouse/inventory`, e);
      }
    }
    result.vehicleWarehouses = allVehicleWarehouses.length;
    result.vehicleInventories = allVehicleInventories.length;
    if (allVehicleWarehouses.length > 0) {
      log('db', 'vehicle_warehouses');
      await vehicleWarehousesDb.upsertVehicleWarehouses(allVehicleWarehouses);
    }
    if (allVehicleInventories.length > 0) log('db', 'vehicle_inventories');
    /** Second pass: retry queue after data pull (unblocks payment/delivery that depended on server state). */
    try {
      await processSyncQueue();
      await processStandaloneOfflineAttachments();
    } catch (e) {
      logWarn('sync second queue pass', e);
    }
    //TODO: count column should renamed to results
    await syncLogDb.appendLog({
      sync_at: syncAt,
      status: 'success',
      message: result.error ? result.error : 'Sync successful',
      counts: JSON.stringify(result),
    });
    const storage = await getAsyncStorage();
    await storage.setItem(KEYS.LAST_SYNC, syncAt);
    log('done', JSON.stringify(result));
    if (_syncCompleteListener) {
      try {
        _syncCompleteListener(true);
      } catch (e) {
        console.warn(`${LOG_TAG} syncCompleteListener`, e?.message ?? e);
      }
    }
    return result;
  } catch (err) {
    result.error = err?.message || 'Sync failed';
    logWarn('error', err);
    console.warn(`${LOG_TAG} error detail`, err);
    //TODO: count column should renamed to results
    try {
      await syncLogDb.appendLog({
        sync_at: syncAt,
        status: 'error',
        message: typeof result.error === 'string' ? result.error : String(result.error ?? 'Sync failed'),
        counts: JSON.stringify(result),
      });
    } catch (logErr) {
      console.warn(`${LOG_TAG} could not append error to sync_log`, logErr?.message ?? logErr);
    }
    if (_syncCompleteListener) {
      try {
        const msg = typeof result.error === 'string' ? result.error : String(result.error ?? 'Sync failed');
        _syncCompleteListener(false, msg);
      } catch (e) {
        console.warn(`${LOG_TAG} syncCompleteListener`, e?.message ?? e);
      }
    }
    return result;
  } finally {
    if (_syncStateListener) _syncStateListener(false);
  }
}

/**
 * Public sync entrypoint with concurrency guard.
 * Prevents overlapping sync runs (from app-state, login, and screen triggers)
 * that can cause transient empty reads while writes are still in progress.
 */
export async function runSync() {
  if (_runSyncPromise) {
    log('skip', 'already running; awaiting in-flight sync');
    return _runSyncPromise;
  }
  _runSyncPromise = runSyncInternal();
  try {
    return await _runSyncPromise;
  } finally {
    _runSyncPromise = null;
  }
}

/**
 * Fast-path upload: process only pending queue + attachments without full pull sync.
 * Used when the user just completed an order and is online, so backend updates can
 * happen immediately without waiting for the next interval.
 */
export async function flushPendingUploadsNow(options = {}) {
  const includeAttachments = options?.includeAttachments !== false;
  const aggressive = options?.aggressive === true;
  const maxPasses = Math.min(Math.max(Number(options?.queuePasses) || 8, 1), 20);
  const stallMs = aggressive ? QUEUE_SYNC_AGGRESSIVE_PASS_DELAY_MS : QUEUE_SYNC_FAST_PASS_DELAY_MS;
  try {
    let lastPending = -1;
    for (let pass = 0; pass < maxPasses; pass++) {
      await processSyncQueue();
      if (includeAttachments) {
        await processStandaloneOfflineAttachments();
      }
      const pending = await syncQueueDb.getPendingCount();
      if (pending === 0) break;
      if (lastPending >= 0 && pending < lastPending) {
        lastPending = pending;
        if (pass < maxPasses - 1) {
          await new Promise((r) => setTimeout(r, stallMs));
        }
        continue;
      }
      if (pending === lastPending && pass < maxPasses - 1) {
        await new Promise((r) => setTimeout(r, stallMs));
      }
      lastPending = pending;
    }
    try {
      const session = await getUserSession();
      if (session) {
        const vehicleId = session?.vehicleId != null && session?.isAdmin !== true ? session.vehicleId : null;
        const orders = (await getCachedOrders(vehicleId)) || [];
        const pendingSaleOrderIds = await syncQueueDb.getPendingSaleOrderIds();
        const localInvoicesMod = await import('../database/localInvoices.js');
        const unsyncedInvoiceSoIds = await localInvoicesMod.getUnsyncedLocalInvoiceSaleOrderIds();
        const paymentRefreshSkipIds = new Set();
        for (const id of pendingSaleOrderIds) {
          const n = Number(id);
          if (Number.isFinite(n)) paymentRefreshSkipIds.add(n);
        }
        for (const soId of unsyncedInvoiceSoIds) {
          const idNum = Number(soId);
          if (Number.isFinite(idNum) && idNum > 0) paymentRefreshSkipIds.add(idNum);
        }
        await refreshPaymentTypesFromOdoo(orders, { skipOrderIds: paymentRefreshSkipIds });
      }
    } catch (refreshErr) {
      logWarn('flushPendingUploadsNow payment refresh', refreshErr);
    }
  } catch (e) {
    logWarn('flushPendingUploadsNow', e);
  }
  try {
    const pendingCount = await syncQueueDb.getPendingCount();
    const indicators = hasDashboardUploadIndicators();
    if (pendingCount === 0 && !indicators && _syncCompleteListener) {
      try {
        _syncCompleteListener(true);
      } catch (e) {
        console.warn(`${LOG_TAG} syncCompleteListener after flush`, e?.message ?? e);
      }
    }
    return { pendingCount };
  } catch (_) {
    return { pendingCount: null };
  }
}

export async function syncVehiclesOnly() {
  try {
    const { getVehicles } = await import('./vehicle.service');
    const vehicles = await getVehicles();

    if (vehicles && vehicles.length > 0) {

      await vehiclesDb.upsertVehicles(vehicles);
      return true;
    }
  } catch (e) {
    console.error("Vehicle sync failed", e);
  }
  return false;
}

/**
 * Clear all data from all tables (for logout).
 */
export async function clearAllTables() {

  setIsLoggingOut(true);
  const db = await getDb();

  // Removed 'vehicles' and 'vehicle_warehouses' from this list
  const tables = [
    'partners',
    'sale_orders',
    'sale_order_lines',
    'products',
    'stock_pickings',
    'stock_moves',
    'stock_move_lines',
    'account_journals',
    'routes',
    'vehicle_inventories',
    'local_payments',
    'local_invoices',
    'sync_queue',
    'sync_log'
  ];


  try {
    for (const table of tables) {
      console.log(`[DB] Clearing ${table}...`);
      await db.runAsync(`DELETE FROM ${table}`);
    }
    const storage = await getAsyncStorage();
    await storage.multiRemove(TRANSLATION_STORAGE_KEYS);
    return true;
  } catch (error) {
    return false;
  } finally {
    setIsLoggingOut(false);
  }
}
