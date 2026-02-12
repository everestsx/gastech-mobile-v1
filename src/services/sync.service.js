/**
 * Offline-first sync: pull from Odoo into SQLite, serve all data from local DB.
 * Sync = fetch from backend and store; app reads only from DB.
 */
import { getCustomers } from './customer.service';
import { getAllSaleOrders } from './saleOrder.service';
import { getStockMovesByPickingId, getStockMoveLinesByMoveIds } from './delivery.service';
import { getJournals } from './journal.service';
import { getRoutes } from './route.service';
import { getVehicles } from './vehicle.service';
import * as partnersDb from '../database/partners.js';
import * as saleOrdersDb from '../database/saleOrders.js';
import * as saleOrderLinesDb from '../database/saleOrderLines.js';
import * as stockPickingsDb from '../database/stockPickings.js';
import * as stockMovesDb from '../database/stockMoves.js';
import * as stockMoveLinesDb from '../database/stockMoveLines.js';
import * as journalsDb from '../database/journals.js';
import * as routesDb from '../database/routes.js';
import * as vehiclesDb from '../database/vehicles.js';
import * as productsDb from '../database/products.js';
import * as syncLogDb from '../database/syncLog.js';

const KEYS = {
  USER: '@gastech_user',
  LAST_SYNC: '@gastech_last_sync',
};

const SYNC_INTERVAL_MS = 60 * 1000; // 1 minute auto-sync when online

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

export async function getCachedOrders() {
  try {
    return await saleOrdersDb.getAllSaleOrders();
  } catch (e) {
    console.warn('getCachedOrders', e);
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

export async function getLastSyncTime() {
  try {
    return await syncLogDb.getLastSyncTime();
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
  const result = { customers: 0, orders: 0, orderLines: 0, pickings: 0, moves: 0, moveLines: 0, journals: 0, routes: 0, vehicles: 0, error: null };
  const syncAt = new Date().toISOString();
  log('start', syncAt);

  try {
    log('fetch', 'customers + orders');
    const [customers, orders] = await Promise.all([
      getCustomers().catch((e) => {
        logWarn('fetch customers', e);
        return [];
      }),
      getAllSaleOrders().catch((e) => {
        logWarn('fetch orders', e);
        return [];
      }),
    ]);

    result.customers = (customers || []).length;
    result.orders = (orders || []).length;
    log('fetch', `customers=${result.customers} orders=${result.orders}`);

    log('db', 'partners');
    await partnersDb.upsertPartners(customers || []);
    log('db', 'sale_orders');
    await saleOrdersDb.upsertSaleOrders(orders || []);

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
      log('db', `products (${productIds.size})`);
      await productsDb.upsertProducts(Array.from(productIds).map((id) => ({ id, name: null })));
    }

    log('fetch', 'journals + routes + vehicles');
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
    log('db', 'journals + routes + vehicles');
    await journalsDb.upsertJournals(journals || []);
    await routesDb.upsertRoutes(routes || []);
    await vehiclesDb.upsertVehicles(vehicles || []);

    await syncLogDb.appendLog({
      sync_at: syncAt,
      status: 'success',
      message: null,
      counts: result,
    });
    const storage = await getAsyncStorage();
    await storage.setItem(KEYS.LAST_SYNC, syncAt);
    log('done', JSON.stringify(result));
    return result;
  } catch (err) {
    result.error = err?.message || 'Sync failed';
    logWarn('error', err);
    console.warn(`${LOG_TAG} error detail`, err);
    await syncLogDb.appendLog({
      sync_at: syncAt,
      status: 'error',
      message: result.error,
      counts: result,
    });
    return result;
  }
}
