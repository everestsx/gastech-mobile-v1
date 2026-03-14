/**
 * Pending actions to push to Odoo on sync (delivery updates, payments, etc.).
 * Offline-first: all local updates are persisted and queued here; runSync processes the queue.
 */
import { getDb } from './db.js';
import { empty, num, iso } from './dbHelpers.js';

/** Delivery + order line updates: qtys, validate picking. Payload: { saleOrderId, pickingId, orderLineUpdates, moveUpdates, moveLineUpdates } */
export const ACTION_DELIVERY = 'delivery';
/** Payment: create invoice and payments. Payload: { saleOrderId, partnerId, orderName, total, payments[], deliveryPhotoUris? } */
export const ACTION_PAYMENT = 'payment';
/** Vehicle inventory update after delivery. Payload: { vehicleId, locationId, updates[] } */
export const ACTION_INVENTORY_UPDATE = 'inventory_update';

export async function enqueue(actionType, payload) {
  const db = await getDb();
  const result = await db.runAsync(
    'INSERT INTO sync_queue (action_type, payload, created_at) VALUES (?, ?, ?)',
    [empty(actionType) || 'unknown', typeof payload === 'string' ? payload : JSON.stringify(payload ?? {}), iso()]
  );
  return result.lastInsertRowId;
}

export async function getPending() {
  const db = await getDb();
  const rows = await db.getAllAsync(
    'SELECT id, action_type, payload, created_at FROM sync_queue WHERE synced_at IS NULL ORDER BY id ASC'
  );
  return (rows || []).map((row) => ({
    id: row.id,
    action_type: row.action_type,
    payload: safeParseJson(row.payload, {}),
    created_at: row.created_at,
  }));
}

export async function markSynced(id) {
  const db = await getDb();
  await db.runAsync('UPDATE sync_queue SET synced_at = ? WHERE id = ?', [iso(), num(id)]);
}

export async function getPendingCount() {
  const db = await getDb();
  const row = await db.getFirstAsync(
    'SELECT COUNT(*) as c FROM sync_queue WHERE synced_at IS NULL'
  );
  return row?.c ?? 0;
}

/** Get sale order ids that already have a synced payment (avoid duplicate payments on retry). */
export async function getSyncedPaymentSaleOrderIds() {
  const db = await getDb();
  const rows = await db.getAllAsync(
    `SELECT payload FROM sync_queue WHERE action_type = ? AND synced_at IS NOT NULL`,
    [ACTION_PAYMENT]
  );
  const ids = new Set();
  for (const row of rows || []) {
    const p = safeParseJson(row.payload, {});
    const soId = p.saleOrderId ?? p.sale_order_id;
    if (soId != null) ids.add(Number(soId));
  }
  return ids;
}

/** Get sale order ids that have pending (not yet synced) delivery or payment in the queue. Used to preserve local state during sync download. */
export async function getPendingSaleOrderIds() {
  const db = await getDb();
  const rows = await db.getAllAsync(
    `SELECT action_type, payload FROM sync_queue WHERE synced_at IS NULL`
  );
  const ids = new Set();
  for (const row of rows || []) {
    const p = safeParseJson(row.payload, {});
    const soId = p.saleOrderId ?? p.sale_id;
    if (soId != null) ids.add(Number(soId));
  }
  return ids;
}

/** Get pending (unsynced) payment queue item for a sale order, if any. Returns { id, payload } or null. Used to avoid duplicate queue entries. */
export async function getPendingPaymentItemBySaleOrderId(saleOrderId) {
  if (saleOrderId == null) return null;
  const db = await getDb();
  const rows = await db.getAllAsync(
    `SELECT id, payload FROM sync_queue WHERE action_type = ? AND synced_at IS NULL`,
    [ACTION_PAYMENT]
  );
  const soId = Number(saleOrderId);
  for (const row of rows || []) {
    const p = safeParseJson(row.payload, {});
    const id = p.saleOrderId ?? p.sale_order_id;
    if (id != null && Number(id) === soId) return { id: row.id, payload: p };
  }
  return null;
}

/** Update payload of an existing queue item (e.g. to merge payment updates for same sale order). */
export async function updateQueueItemPayload(id, payload) {
  const db = await getDb();
  const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload ?? {});
  await db.runAsync('UPDATE sync_queue SET payload = ? WHERE id = ?', [payloadStr, num(id)]);
}

/** Get synced_at for payment queue item by sale order id. Returns null if not synced or no payment queued. */
export async function getPaymentSyncedAtForSaleOrder(saleOrderId) {
  if (saleOrderId == null) return null;
  const db = await getDb();
  const rows = await db.getAllAsync(
    `SELECT payload, synced_at FROM sync_queue WHERE action_type = ? AND synced_at IS NOT NULL`,
    [ACTION_PAYMENT]
  );
  const soId = Number(saleOrderId);
  for (const row of rows || []) {
    const p = safeParseJson(row.payload, {});
    const id = p.saleOrderId ?? p.sale_order_id;
    if (id != null && Number(id) === soId) return row.synced_at;
  }
  return null;
}

function safeParseJson(str, fallback) {
  if (str == null || str === '') return fallback;
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}
