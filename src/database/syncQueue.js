/**
 * Pending actions to push to Odoo on sync (delivery updates, payments, etc.).
 * Offline-first: all local updates are persisted and queued here; runSync processes the queue.
 */
import { getDb } from './db.js';
import { empty, num, iso } from './dbHelpers.js';

/** Delivery: validate picking + stock moves/lines. Payload: { saleOrderId, pickingId, pickings[], orderLineUpdates (product_uom_qty — Modify only), saleOrderLineDeliveredUpdates ({ lineId, qty_delivered }), moveUpdates, moveLineUpdates, holdUntilPayment?: true } — when true, sync.service skips until a payment queue item runs (then flushes to Odoo before invoice). */
export const ACTION_DELIVERY = 'delivery';
/** Payment: create invoice and payments. Payload: { saleOrderId, partnerId, orderName, total, payments[], deliveryPhotoUris? } */
export const ACTION_PAYMENT = 'payment';
/** Vehicle inventory update after delivery. Payload: { vehicleId, locationId, updates[] } */
export const ACTION_INVENTORY_UPDATE = 'inventory_update';

export async function enqueue(actionType, payload) {
  const db = await getDb();
  const payloadStr =
    typeof payload === 'string'
      ? payload
      : JSON.stringify(payload ?? {}, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
  await db.runAsync(
    'INSERT INTO sync_queue (action_type, payload, created_at, is_uploaded) VALUES (?, ?, ?, 0)',
    [empty(actionType) || 'unknown', payloadStr, iso()]
  );
  const row = await db.getFirstAsync('SELECT last_insert_rowid() AS id');
  return num(row?.id);
}

export async function getPending() {
  const db = await getDb();
  const rows = await db.getAllAsync(
    'SELECT id, action_type, payload, created_at FROM sync_queue WHERE COALESCE(is_uploaded, 0) = 0 AND synced_at IS NULL ORDER BY id ASC'
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
  await db.runAsync('UPDATE sync_queue SET synced_at = ?, is_uploaded = 1 WHERE id = ?', [iso(), num(id)]);
}

export async function getPendingCount() {
  const db = await getDb();
  const row = await db.getFirstAsync(
    'SELECT COUNT(*) as c FROM sync_queue WHERE COALESCE(is_uploaded, 0) = 0 AND synced_at IS NULL'
  );
  return row?.c ?? 0;
}

/** Get sale order ids that already have a synced payment (avoid duplicate payments on retry). */
export async function getSyncedPaymentSaleOrderIds() {
  const db = await getDb();
  const rows = await db.getAllAsync(
    `SELECT payload FROM sync_queue WHERE action_type = ? AND (COALESCE(is_uploaded, 0) = 1 OR synced_at IS NOT NULL)`,
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
    `SELECT action_type, payload FROM sync_queue WHERE COALESCE(is_uploaded, 0) = 0 AND synced_at IS NULL`
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
    `SELECT id, payload FROM sync_queue WHERE action_type = ? AND COALESCE(is_uploaded, 0) = 0 AND synced_at IS NULL`,
    [ACTION_PAYMENT]
  );
  const soId = Number(saleOrderId);
  let best = null;
  for (const row of rows || []) {
    const p = safeParseJson(row.payload, {});
    const id = p.saleOrderId ?? p.sale_order_id;
    if (id != null && Number(id) === soId) {
      if (!best || Number(row.id) > Number(best.id)) {
        best = { id: row.id, payload: p };
      }
    }
  }
  return best;
}

/** Get pending (unsynced) delivery queue item for a sale order, if any. Used to avoid duplicate delivery/qty. */
export async function getPendingDeliveryItemBySaleOrderId(saleOrderId) {
  if (saleOrderId == null) return null;
  const db = await getDb();
  const rows = await db.getAllAsync(
    `SELECT id, payload FROM sync_queue WHERE action_type = ? AND COALESCE(is_uploaded, 0) = 0 AND synced_at IS NULL`,
    [ACTION_DELIVERY]
  );
  const soId = Number(saleOrderId);
  let best = null;
  for (const row of rows || []) {
    const p = safeParseJson(row.payload, {});
    const id = p.saleOrderId ?? p.sale_order_id;
    if (id != null && Number(id) === soId) {
      if (!best || Number(row.id) > Number(best.id)) {
        best = { id: row.id, payload: p };
      }
    }
  }
  return best;
}

/**
 * Get pending (unsynced) inventory_update queue item for a sale order, if any.
 * Returns the latest queue row id for that SO — same semantics as delivery/payment (avoids patching stale duplicates).
 */
export async function getPendingInventoryUpdateItemBySaleOrderId(saleOrderId) {
  if (saleOrderId == null) return null;
  const db = await getDb();
  const rows = await db.getAllAsync(
    `SELECT id, payload FROM sync_queue WHERE action_type = ? AND COALESCE(is_uploaded, 0) = 0 AND synced_at IS NULL`,
    [ACTION_INVENTORY_UPDATE]
  );
  const soId = Number(saleOrderId);
  let best = null;
  for (const row of rows || []) {
    const p = safeParseJson(row.payload, {});
    const id = p.saleOrderId ?? p.sale_order_id;
    if (id != null && Number(id) === soId) {
      if (!best || Number(row.id) > Number(best.id)) {
        best = { id: row.id, payload: p };
      }
    }
  }
  return best;
}

/** Update payload of an existing queue item (e.g. to merge payment updates for same sale order). */
export async function updateQueueItemPayload(id, payload) {
  const db = await getDb();
  const payloadStr =
    typeof payload === 'string'
      ? payload
      : JSON.stringify(payload ?? {}, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
  await db.runAsync('UPDATE sync_queue SET payload = ? WHERE id = ?', [payloadStr, num(id)]);
}

/** Delete pending queue items for a sale order so a cancelled order does not keep old work queued. */
export async function deletePendingItemsBySaleOrderId(saleOrderId, actionTypes = [ACTION_DELIVERY, ACTION_PAYMENT, ACTION_INVENTORY_UPDATE]) {
  if (saleOrderId == null) return 0;
  const db = await getDb();
  const rows = await db.getAllAsync(
    `SELECT id, payload, action_type FROM sync_queue WHERE COALESCE(is_uploaded, 0) = 0 AND synced_at IS NULL`,
    []
  );
  const soId = Number(saleOrderId);
  const allowed = new Set((Array.isArray(actionTypes) ? actionTypes : [actionTypes]).filter(Boolean));
  const idsToDelete = [];
  for (const row of rows || []) {
    if (allowed.size > 0 && !allowed.has(row.action_type)) continue;
    const payload = safeParseJson(row.payload, {});
    const id = payload.saleOrderId ?? payload.sale_order_id ?? payload.orderId ?? payload.order_id;
    if (id != null && Number(id) === soId) idsToDelete.push(row.id);
  }
  if (idsToDelete.length === 0) return 0;
  const placeholders = idsToDelete.map(() => '?').join(',');
  await db.runAsync(`DELETE FROM sync_queue WHERE id IN (${placeholders})`, idsToDelete);
  return idsToDelete.length;
}

/** Get synced_at for payment queue item by sale order id. Returns null if not synced or no payment queued. */
export async function getPaymentSyncedAtForSaleOrder(saleOrderId) {
  if (saleOrderId == null) return null;
  const db = await getDb();
  const rows = await db.getAllAsync(
    `SELECT payload, synced_at FROM sync_queue WHERE action_type = ? AND (COALESCE(is_uploaded, 0) = 1 OR synced_at IS NOT NULL)`,
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

/** Latest payment payload by sale order id from both pending and synced queue items. */
export async function getLatestPaymentPayloadMapBySaleOrderIds(saleOrderIds) {
  if (!Array.isArray(saleOrderIds) || saleOrderIds.length === 0) return {};
  const wanted = new Set(
    saleOrderIds
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id))
  );
  if (wanted.size === 0) return {};
  const db = await getDb();
  const rows = await db.getAllAsync(
    `SELECT id, payload
     FROM sync_queue
     WHERE action_type = ?`,
    [ACTION_PAYMENT]
  );
  const bySaleOrderId = {};
  for (const row of rows || []) {
    const payload = safeParseJson(row.payload, {});
    const soIdRaw = payload.saleOrderId ?? payload.sale_order_id;
    const soId = Number(soIdRaw);
    if (!Number.isFinite(soId) || !wanted.has(soId)) continue;
    const existing = bySaleOrderId[soId];
    if (!existing || Number(row.id) > Number(existing.queueId)) {
      bySaleOrderId[soId] = {
        queueId: Number(row.id),
        payload,
      };
    }
  }
  return bySaleOrderId;
}

function safeParseJson(str, fallback) {
  if (str == null || str === '') return fallback;
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}
