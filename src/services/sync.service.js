/**
 * Offline-first sync: pull from Odoo into SQLite, serve all data from local DB.
 * Sync = fetch from backend and store; app reads only from DB.
 */
import { getCustomers, getPartnersByIds } from './customer.service';
import { getAllSaleOrders, getSaleOrdersByVehicle } from './saleOrder.service';
import { getAllProducts, getProductsByIds } from './product.service';
import { getStockMovesByPickingId, getStockMoveLinesByMoveIds } from './delivery.service';
import { getJournals } from './journal.service';
import { getRoutes } from './route.service';
import { getVehicles, getVehicleById } from './vehicle.service';
import { getStockLocationByVehicle } from './vehicleWarehouse.service';
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
import {getDb} from "@/src/database/db";
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
const KEYS = {
  USER: '@gastech_user',
  LAST_SYNC: '@gastech_last_sync',
  LAST_VEHICLE_ID: '@gastech_last_vehicle_id',
};

const SYNC_INTERVAL_MS = 600 * 1000; // 1 minute auto-sync when online

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

export async function getUserSession() {
  try {
    const storage = await getAsyncStorage();
    const raw = await storage.getItem(KEYS.USER);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function saveUserSession(user) {
  const storage = await getAsyncStorage();
  await storage.setItem(KEYS.USER, JSON.stringify(user));
}

export async function saveLastVehicleId(vehicleId) {
  try {
    const storage = await getAsyncStorage();
    await storage.setItem(KEYS.LAST_VEHICLE_ID, String(vehicleId));
  } catch (_) {}
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
  const storage = await getAsyncStorage();
  await storage.multiRemove([KEYS.USER, KEYS.LAST_SYNC]);
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
    return await saleOrdersDb.getAllSaleOrders(vehicleId);
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

/** Sale order details from local DB (order + lines). Same shape as API. */
export async function getSaleOrderDetailsFromDB(saleOrderId) {
  try {
    const order = await saleOrdersDb.getSaleOrderById(Number(saleOrderId));
    if (!order) return { order: null, lines: [] };
    const orderLineIds = order.order_line || [];
    if (orderLineIds.length === 0) return { order, lines: [] };
    const lines = await saleOrderLinesDb.getSaleOrderLinesByOrderIds([order.id]);
    return { order, lines };
  } catch (e) {
    console.warn('getSaleOrderDetailsFromDB', e);
    return { order: null, lines: [] };
  }
}

/** Delivery data from local DB: picking, moves, moveLines for a sale order. */
export async function getDeliveryDataFromDB(saleOrderId) {
  try {
    const pickings = await stockPickingsDb.getStockPickingsBySaleId(Number(saleOrderId));
    const picking = pickings[0] ?? null;
    if (!picking?.move_ids?.length) return { picking, moves: [], moveLines: [] };
    const moveIds = picking.move_ids;
    const [moves, moveLines] = await Promise.all([
      stockMovesDb.getStockMovesByPickingId(picking.id),
      stockMoveLinesDb.getStockMoveLinesByMoveIds(moveIds),
    ]);
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

/** Classify payment type by journal code (CSH1 = cash, CSH2 = cheque) or fallback by journal name. */
function paymentTypeFromJournal(journalId, codeMap = {}) {
  const id = Array.isArray(journalId) ? journalId[0] : journalId;
  const code = id != null ? (codeMap[id] || '').toUpperCase().trim() : '';
  const jName = Array.isArray(journalId) ? (journalId[1] || '') : String(journalId || '');
  const j = jName.toLowerCase();
  // Prefer Odoo journal code so Cheque (CSH2) is never misclassified as cash
  if (code === 'CSH2') return 'cheque';
  if (code === 'CSH1') return 'cash';
  if (j.includes('cheque') || j.includes('check')) return 'cheque';
  if (j.includes('cash')) return 'cash';
  return 'cheque';
}

/**
 * Refresh payment_type from Odoo so Delivered tabs and Dashboard show correct Cash/Cheque/Credit on all devices.
 * Flow: (1) Only invoiced orders. (2) If invoice payment_state is not 'paid' (e.g. in_payment, not_paid) → credit.
 * (3) If paid → get account.payment by reconciled_invoice_ids; by journal_id (Cash vs Cheque) set cash or cheque.
 * @param {Array<{ name?: string, invoice_status?: string }>} syncedOrders - orders just synced from Odoo
 */
export async function refreshPaymentTypesFromOdoo(syncedOrders) {
  const orderNames = (syncedOrders || [])
    .filter((o) => String(o.invoice_status || '') === 'invoiced' && o.name)
    .map((o) => o.name);
  if (orderNames.length === 0) return;
  try {
    const { getInvoicesByOrigins, getPaymentsByInvoiceIds } = await import('./invoice.service');
    const invoices = await getInvoicesByOrigins(orderNames);
    if (!invoices?.length) return;

    const paidInvoiceIds = [];
    const orderNameToType = {};

    for (const inv of invoices) {
      const origin = inv.invoice_origin;
      const state = (inv.payment_state || '').toLowerCase();
      if (state === 'paid') {
        paidInvoiceIds.push(inv.id);
      } else {
        if (origin) orderNameToType[origin] = 'credit';
      }
    }

    if (paidInvoiceIds.length > 0) {
      const payments = await getPaymentsByInvoiceIds(paidInvoiceIds);
      const journalIds = (payments || [])
        .map((pm) => (Array.isArray(pm.journal_id) ? pm.journal_id[0] : pm.journal_id))
        .filter((id) => id != null);
      const { getJournalCodesByIds } = await import('./journal.service.js');
      const journalCodeMap = journalIds.length > 0 ? await getJournalCodesByIds(journalIds) : {};
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
      for (const inv of invoices) {
        if ((inv.payment_state || '').toLowerCase() !== 'paid' || !inv.invoice_origin) continue;
        const pms = invoiceIdToPayments[inv.id] || [];
        let cashSum = 0;
        let chequeSum = 0;
        for (const pm of pms) {
          const amt = Number(pm.amount) || 0;
          const type = paymentTypeFromJournal(pm.journal_id, journalCodeMap);
          if (type === 'cash') cashSum += amt;
          else chequeSum += amt;
        }
        const orderType =
          chequeSum > 0 && cashSum === 0
            ? 'cheque'
            : cashSum > 0
              ? 'cash'
              : chequeSum > 0
                ? 'cheque'
                : 'credit';
        orderNameToType[inv.invoice_origin] = orderType;
      }
    }

    for (const name of Object.keys(orderNameToType)) {
      await saleOrdersDb.updatePaymentTypeByOrderName(name, orderNameToType[name]);
    }
    log('refresh', `payment_type updated for ${Object.keys(orderNameToType).length} orders from Odoo`);
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
    const { getInvoicesByOrigins, getPaymentsByInvoiceIds } = await import('./invoice.service');
    const invoices = await getInvoicesByOrigins(orderNames);
    if (!invoices?.length) return { cashTotal: 0, chequeTotal: 0, creditTotal: 0 };

    let cashTotal = 0;
    let chequeTotal = 0;
    let creditTotal = 0;
    const paidInvoiceIds = [];

    for (const inv of invoices) {
      const state = (inv.payment_state || '').toLowerCase();
      const amount = Number(inv.amount_total) || 0;
      if (state === 'paid') {
        paidInvoiceIds.push(inv.id);
      } else {
        creditTotal += amount;
      }
    }

    if (paidInvoiceIds.length > 0) {
      const payments = await getPaymentsByInvoiceIds(paidInvoiceIds);
      const journalIds = (payments || [])
        .map((pm) => (Array.isArray(pm.journal_id) ? pm.journal_id[0] : pm.journal_id))
        .filter((id) => id != null);
      const { getJournalCodesByIds } = await import('./journal.service.js');
      const journalCodeMap = journalIds.length > 0 ? await getJournalCodesByIds(journalIds) : {};
      for (const pm of payments || []) {
        const amount = Number(pm.amount) || 0;
        const type = paymentTypeFromJournal(pm.journal_id, journalCodeMap);
        if (type === 'cash') cashTotal += amount;
        else chequeTotal += amount;
      }
    }

    return { cashTotal, chequeTotal, creditTotal };
  } catch (e) {
    console.warn('getCollectionTotalsFromOdoo', e);
    return null;
  }
}

/** Process pending sync queue: push delivery and payment actions to Odoo. Run at start of runSync. */
async function processSyncQueue() {
  const pending = await syncQueueDb.getPending();
  if (!pending.length) return;
  log('queue', `processing ${pending.length} pending`);
  const delivery = pending.filter((p) => p.action_type === syncQueueDb.ACTION_DELIVERY);
  const payment = pending.filter((p) => p.action_type === syncQueueDb.ACTION_PAYMENT);
  const {
    updateSaleOrderLineQty,
    confirmSaleOrder,
  } = await import('./saleOrderLine.service');
  const {
    getPickingBySaleOrder,
    getStockMovesByPickingId,
    getStockMoveLinesByMoveIds,
    updateMoveLineQty,
    updateStockMoveQty,
    validatePicking,
    createBackorderConfirmation,
    processBackorderConfirmation,
  } = await import('./delivery.service');
  const {
    getSaleOrderForPayment,
    getSaleOrderInvoiceIds,
    getInvoiceState,
    createAdvancePaymentWizard,
    createInvoicesFromWizard,
    postInvoice,
    createPayment,
    postPaymentAndReconcile,
  } = await import('./invoice.service');

  for (const item of delivery) {
    try {
      const p = item.payload || {};
      const saleOrderId = p.saleOrderId ?? p.sale_id;
      const pickingId = p.pickingId ?? p.picking_id;
      const orderLineUpdates = p.orderLineUpdates || [];
      const moveUpdates = p.moveUpdates || [];
      const moveLineUpdates = p.moveLineUpdates || [];

      for (const u of orderLineUpdates) {
        await updateSaleOrderLineQty(u.lineId, u.product_uom_qty);
      }
      for (const u of moveUpdates) {
        await updateStockMoveQty(u.moveId, u.product_uom_qty);
      }
      for (const u of moveLineUpdates) {
        await updateMoveLineQty(u.moveLineId, u.qty_done);
      }
      if (pickingId != null) {
        const validateResult = await validatePicking(pickingId);
        if (validateResult != null && typeof validateResult === 'object') {
          const pickIds = validateResult.pick_ids ?? validateResult.backorder_pick_ids ?? [];
          const ids = (Array.isArray(pickIds) ? pickIds : []).map((id) => (Array.isArray(id) ? id[0] : id)).filter(Boolean);
          if (ids.length > 0) {
            const wizardId = await createBackorderConfirmation(ids);
            if (wizardId != null) await processBackorderConfirmation(wizardId);
          }
        }
      }
      await syncQueueDb.markSynced(Number(item.id));
      log('queue', `delivery synced id=${item.id}`);
    } catch (e) {
      logWarn('queue delivery', e);
    }
  }

  const alreadySyncedSaleOrderIds = await syncQueueDb.getSyncedPaymentSaleOrderIds();
  const chatterPostedInThisRun = new Set();

  for (const item of payment) {
    let invoiceBlockFailedNoItemsToInvoice = false;
    try {
      const p = item.payload || {};
      const saleOrderId = p.saleOrderId ?? p.sale_id;
      const soId = typeof saleOrderId === 'number' ? saleOrderId : parseInt(saleOrderId, 10);
      if (saleOrderId == null || Number.isNaN(soId)) {
        logWarn('queue payment', new Error('Invalid sale_order_id'));
        continue;
      }

      const payments = p.payments || [];
      const orderName = p.orderName ?? `Order ${saleOrderId}`;
      const skipPaymentCreation = alreadySyncedSaleOrderIds.has(soId);

      if (!skipPaymentCreation) {
        try {
          const orderInfo = await getSaleOrderForPayment(saleOrderId);
          if (!orderInfo) {
            logWarn('queue payment', new Error('Sale order not found'));
          } else {
            const partnerId = Array.isArray(orderInfo.partner_id) ? orderInfo.partner_id[0] : orderInfo.partner_id;
            if (partnerId != null) {
              const existingInvoiceIds = orderInfo.invoice_ids ?? [];
              let invoiceAlreadyPosted = false;
              if (existingInvoiceIds.length > 0) {
                const invoiceId = Array.isArray(existingInvoiceIds) ? existingInvoiceIds[0] : existingInvoiceIds;
                const invState = await getInvoiceState(invoiceId).catch(() => ({}));
                if (invState?.state === 'posted') {
                  invoiceAlreadyPosted = true;
                } else if (invState?.state === 'draft') {
                  await postInvoice(invoiceId);
                }
              }

              // Credit = invoice created + posted only (no account.payment). Invoice stays
              // payment_state=not_paid, amount_residual=total → shows as credit under delivery tab.
              if (!invoiceAlreadyPosted) {
                let invoiceId = null;
                if (existingInvoiceIds.length > 0) {
                  invoiceId = Array.isArray(existingInvoiceIds) ? existingInvoiceIds[0] : existingInvoiceIds;
                } else {
                  const wizardId = await createAdvancePaymentWizard(saleOrderId);
                  if (wizardId != null) {
                    await createInvoicesFromWizard(wizardId, saleOrderId);
                    const invoiceIds = await getSaleOrderInvoiceIds(saleOrderId);
                    invoiceId = Array.isArray(invoiceIds) ? invoiceIds[0] : invoiceIds;
                    if (invoiceId != null) await postInvoice(invoiceId);
                  }
                }
                // Credit-only: invoice created + posted is enough; no payment → shows under delivery tab as credit.
                const onlyCredit = payments.length > 0 && payments.every((pm) => pm.type === 'credit');
                if (onlyCredit && invoiceId != null) {
                  log('queue', `credit only: invoice ${invoiceId} posted (no payment) → shows as credit under delivery`);
                }
                // Resolve Cash/Cheque journal from Odoo when missing so cheque is handled like cash (post + reconcile).
                const needsJournalResolve = payments.some(
                  (pm) => (pm.type === 'cash' || pm.type === 'check') && !pm.journalId
                );
                let resolvedCashId = null;
                let resolvedChequeId = null;
                if (needsJournalResolve) {
                  try {
                    const { getCashTypeJournalIds } = await import('./journal.service.js');
                    const ids = await getCashTypeJournalIds();
                    resolvedCashId = ids.cashJournalId ?? null;
                    resolvedChequeId = ids.chequeJournalId ?? null;
                    if (resolvedChequeId != null || resolvedCashId != null) {
                      log('queue', `resolved journals from Odoo: cash=${resolvedCashId ?? '—'} cheque=${resolvedChequeId ?? '—'}`);
                    }
                  } catch (resolveErr) {
                    logWarn('queue payment resolve journals', resolveErr);
                  }
                }
                const dateStr = new Date().toISOString().slice(0, 10);
                const baseMemo = p.invoiceNumber
                  ? `Payment for Invoice ${p.invoiceNumber} / Order ${orderName}`
                  : `Payment for Invoice / Order ${orderName}`;
                for (const pm of payments) {
                  // Credit: no account.payment; invoice stays not_paid → shows in delivery tab under credit.
                  if (pm.type === 'credit') continue;
                  const amount = Number(pm.amount);
                  const journalId = pm.journalId ?? (pm.type === 'cash' ? resolvedCashId : pm.type === 'check' ? resolvedChequeId : null);
                  if (!amount || journalId == null) {
                    if (amount && journalId == null) logWarn('queue payment', new Error(`No journal for ${pm.type}; skipping payment amount ${amount}`));
                    continue;
                  }
                  const paymentId = await createPayment({
                    partnerId,
                    amount,
                    currencyId: 1,
                    journalId,
                    date: dateStr,
                    memo: `${baseMemo} (${pm.type || 'payment'})${pm.checkNumber ? ` #${pm.checkNumber}` : ''}`,
                    invoiceId,
                  });
                  if (paymentId != null && invoiceId != null) {
                    await postPaymentAndReconcile(paymentId, invoiceId);
                    const methodLabel = pm.type === 'check' ? 'cheque' : pm.type === 'cash' ? 'cash' : 'payment';
                    log('queue', `payment created, posted and reconciled (${methodLabel}) id=${paymentId} with invoice ${invoiceId}`);
                  } else if (paymentId != null) {
                    logWarn('queue payment', new Error('Payment created but no invoiceId to reconcile'));
                  }
                }
              }
            }
          }
        } catch (invoiceErr) {
          const msg = (invoiceErr?.message || String(invoiceErr)).toLowerCase();
          if (msg.includes('no items are available to invoice') || msg.includes('nothing to invoice')) {
            invoiceBlockFailedNoItemsToInvoice = true;
            logWarn('queue payment (invoice/payments)', new Error('Invoice creation failed: delivery not done or no quantities. Complete delivery in Odoo first, then sync again for cheque/credit.'));
          } else {
            logWarn('queue payment (invoice/payments)', invoiceErr);
          }
          // Continue to post chatter + proof images when possible
        }
      }

      const {
        buildPaymentProofMessageBody,
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
      const chatterBody = buildPaymentProofMessageBody({
        paymentMethod,
        chequeBankName: paymentMethod === 'cheque' ? chequeBankName : undefined,
        checkNumber: paymentMethod === 'cheque' ? (chequeNumber || undefined) : undefined,
      });

      if (chatterPostedInThisRun.has(soId)) {
        await syncQueueDb.markSynced(Number(item.id));
        alreadySyncedSaleOrderIds.add(soId);
        log('queue', `payment synced id=${item.id} (chatter already posted for SO ${soId})`);
        continue;
      }

      const offlineAttachmentsDb = await import('../database/offlineAttachments.js');
      const pendingAttachments = await offlineAttachmentsDb.getPendingBySaleOrderId(soId);
      const FileSystem = (await import('expo-file-system')).default;

      const attachmentIds = [];
      const syncedAttachmentIds = [];
      const pendingCount = (pendingAttachments || []).length;

      // Doc: read pending URIs from offline_attachments → base64 → ir.attachment.create → collect ids → message_post(attachment_ids).
      log('queue', `payment proof (SO ${soId}): ${pendingCount} pending in offline_attachments — URI→base64→create→message_post`);

      for (const att of pendingAttachments || []) {
        if (!att.local_file_path || !att.file_name) continue;
        try {
          const info = await FileSystem.getInfoAsync(att.local_file_path, { size: false });
          if (!info?.exists) {
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
          const aid = await createProofAttachment(soId, base64, att.file_name);
          attachmentIds.push(aid);
          syncedAttachmentIds.push(att.id);
          log('queue', `ir.attachment.create SO ${soId} → attachment_id=${aid}`);
        } catch (attErr) {
          await offlineAttachmentsDb.incrementRetry(att.id, attErr?.message || 'Upload error');
          logWarn('queue payment proof attachment', attErr);
        }
      }

      if (pendingCount > 0 && attachmentIds.length === 0) {
        logWarn('queue payment proof', new Error('Had pending proof photos but no attachment ids — check file path and createProofAttachment'));
      }

      // API 2: Post message with attachment_ids (required so captured photos appear in sale order chatter)
      try {
        log('queue', `message_post API (sale.order) SO ${soId} attachment_ids=[${attachmentIds.join(', ')}]`);
        await postPaymentProofToChatterWithAttachmentIds(soId, { body: chatterBody, attachmentIds });
        const pendingById = new Map((pendingAttachments || []).map((a) => [Number(a.id), a]));
        for (const id of syncedAttachmentIds) {
          const idNum = Number(id);
          await offlineAttachmentsDb.markSynced(idNum);
          const att = pendingById.get(idNum);
          if (att?.local_file_path) {
            try {
              await FileSystem.deleteAsync(att.local_file_path, { idempotent: true });
            } catch (_) {}
          }
        }
        chatterPostedInThisRun.add(soId);
        log('queue', `chatter posted to SO ${soId} (${attachmentIds.length} images)`);
      } catch (chatterErr) {
        for (const id of syncedAttachmentIds) {
          await offlineAttachmentsDb.incrementRetry(Number(id), chatterErr?.message || 'API error');
        }
        logWarn('queue payment chatter', chatterErr);
        continue;
      }

      if (invoiceBlockFailedNoItemsToInvoice) {
        log('queue', `payment item ${item.id} NOT marked synced (invoice not created — deliver first, then sync again for cheque/credit)`);
        continue;
      }
      await syncQueueDb.markSynced(item.id);
      alreadySyncedSaleOrderIds.add(soId);
      log('queue', `payment synced id=${item.id}`);
    } catch (e) {
      logWarn('queue payment', e);
    }
  }
}

/**
 * Delete all local synced data from SQLite (partners, orders, pickings, etc.)
 * and clear last-sync state. Does not remove user session.
 * After this, running Sync again will repopulate from Odoo.
 */
export async function deleteLocalData() {
  const { getDb } = await import('../database/db.js');
  const db = await getDb();
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
    'sync_log',
    'sync_queue',
  ];
  await db.withTransactionAsync(async (rawDb) => {
    for (const table of tables) {
      await rawDb.runAsync(`DELETE FROM ${table}`);
    }
  });
  const storage = await getAsyncStorage();
  await storage.removeItem(KEYS.LAST_SYNC);
  log('deleteLocalData', 'all synced data cleared');
}

export function getSyncIntervalMs() {
  return SYNC_INTERVAL_MS;
}

export function getSyncIntervalMinutes() {
  return SYNC_INTERVAL_MS / 60000;
}

// ---------- Sync: pull from Odoo and store in SQLite ----------

export async function runSync() {
  if (_syncStateListener) _syncStateListener(true);
  log('start', new Date().toISOString());
  const result = { customers: 0, orders: 0, orderLines: 0, pickings: 0, moves: 0, moveLines: 0, journals: 0, routes: 0, vehicles: 0, vehicleWarehouses: 0, vehicleInventories: 0, error: null };
  const syncAt = new Date().toISOString();
  log('start', syncAt);

  try {
    if (isLoggingOut) {
      return { error: 'Logout in progress' };
    }
    const session = await getUserSession();
    if (!session) {
      return { error: 'No active session' };
    }
    await processSyncQueue();

    const user = await getUserSession();
    // Vehicle-scoped sync: when user has vehicleId and is not admin, sync only that vehicle's data.
    const vehicleId = (user?.vehicleId != null && user?.isAdmin !== true) ? user.vehicleId : null;

    let orders = [];
    let customers = [];

    if (vehicleId != null) {
      log('fetch', `orders for vehicle ${vehicleId} only`);
      orders = await getSaleOrdersByVehicle(vehicleId).catch((e) => {
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
        getAllSaleOrders().catch((e) => {
          logWarn('fetch orders', e);
          return [];
        }),
      ]);
    }

    result.customers = (customers || []).length;
    result.orders = (orders || []).length;
    log('fetch', `customers=${result.customers} orders=${result.orders}`);
    if (isLoggingOut) return { error: 'Logout in progress' };
    log('db', 'partners');
    await partnersDb.upsertPartners(customers || []);
    log('db', 'sale_orders');
    await saleOrdersDb.upsertSaleOrders(orders || []);

    await refreshPaymentTypesFromOdoo(orders || []);

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
        (o.order_line || []).forEach((id) => lineIds.push(id));
      });
      if (lineIds.length > 0) {
        log('fetch', `order lines (${lineIds.length} ids)`);
        const lines = await callOdoo(
          'sale.order.line',
          'search_read',
          [[['id', 'in', lineIds]]],
          {
            fields: ['id', 'order_id', 'product_id', 'name', 'product_uom_qty', 'price_unit', 'price_subtotal', 'price_total'],
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

      for (const p of allPickings) {
        const moveIds = p.move_ids || (Array.isArray(p.move_ids) ? p.move_ids : []);
        if (moveIds.length === 0) continue;
        const [moves, moveLines] = await Promise.all([
          getStockMovesByPickingId(p.id),
          getStockMoveLinesByMoveIds(moveIds),
        ]);
        (moves || []).forEach((m) => {
          allMoves.push({ ...m, picking_id: m.picking_id ?? p.id });
          const pid = Array.isArray(m.product_id) ? m.product_id[0] : m.product_id;
          if (pid) productIds.add(pid);
        });
        (moveLines || []).forEach((ml) => allMoveLines.push(ml));
      }
      result.moves = allMoves.length;
      result.moveLines = allMoveLines.length;
      log('fetch', `moves=${result.moves} moveLines=${result.moveLines}`);
    }

    log('db', 'sale_order_lines');
    await saleOrderLinesDb.upsertSaleOrderLines(allLines);
    log('db', 'stock_pickings');
    await stockPickingsDb.upsertStockPickings(allPickings);
    log('db', 'stock_moves');
    await stockMovesDb.upsertStockMoves(allMoves);
    log('db', 'stock_move_lines');
    await stockMoveLinesDb.upsertStockMoveLines(allMoveLines);
    if (productIds.size > 0) {
      const ids = Array.from(productIds);
      try {
        log('fetch', vehicleId != null ? `product.product (${ids.length} ids)` : 'product.product');
        const products = vehicleId != null
          ? await getProductsByIds(ids)
          : await getAllProducts();
        if (products?.length) {
          log('db', `products (${products.length})`);
          await productsDb.upsertProducts(products);
        } else {
          await productsDb.upsertProducts(ids.map((id) => ({ id, name: null })));
        }
      } catch (e) {
        logWarn('fetch products', e);
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
    for (const v of vehiclesToFetchInventory) {
      const vId = v.id;
      const licensePlate = v.license_plate || (v.name || '').split('/').pop() || '';
      if (!licensePlate) continue;
      try {
        log('fetch', `vehicle warehouse ${licensePlate}`);
        const locations = await getStockLocationByVehicle(licensePlate).catch(() => []);
        const loc = locations && locations[0] ? locations[0] : null;
        if (loc) {
          allVehicleWarehouses.push({
            id: loc.id,
            vehicle_id: vId,
            name: loc.name,
            complete_name: loc.complete_name,
          });
          log('fetch', `vehicle inventory location ${loc.id}  ${vehicleId}`);
          const quants = await getVehicleInventoryByLocation(loc.id).catch(() => []);
          (quants || []).forEach((q) => {
            allVehicleInventories.push({
              ...q,
              location_id: loc.id,
              vehicle_id: vId,
            });
          });
          await vehicleInventoriesDb.upsertVehicleInventories(allVehicleInventories);
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
    if (allVehicleInventories.length > 0) {
      log('db', 'vehicle_inventories');
      await vehicleInventoriesDb.upsertVehicleInventories(allVehicleInventories);
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
    'sync_queue',
    'sync_log'
  ];


  try {
    for (const table of tables) {
      console.log(`[DB] Clearing ${table}...`);
      await db.runAsync(`DELETE FROM ${table}`);
    }

    isLoggingOut = false;
    return true;
  } catch (error) {
    isLoggingOut = false;
    return false;
  }
}
