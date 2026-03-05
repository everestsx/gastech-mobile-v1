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

function safeParseJson(str, fallback) {
  if (str == null || str === '') return fallback;
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}
