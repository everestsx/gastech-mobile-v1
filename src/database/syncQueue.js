/**
 * Pending actions to push to Odoo on sync (delivery updates, payments, etc.).
 * Offline-first: all local updates are persisted and queued here; runSync processes the queue.
 */
import { getDb } from './db.js';
import { empty, num, iso } from './dbHelpers.js';
import { ensureDeliveryTxnOnPayload } from '../utils/deliverySync.js';

/** Delivery: validate picking + stock moves/lines. Payload: { saleOrderId, demandEdit?: boolean, pickingId, pickings[], orderLineUpdates (product_uom_qty — Modify only), saleOrderLineDeliveredUpdates ({ lineId, qty_delivered }), moveUpdates (move demand — Modify only), moveLineUpdates, holdUntilPayment?: true } — when true, sync.service skips until payment completes (then flushes once before invoice). */
export const ACTION_DELIVERY = 'delivery';
/** Payment: create invoice and payments. Payload: { saleOrderId, partnerId, orderName, total, payments[], deliveryPhotoUris? } */
export const ACTION_PAYMENT = 'payment';
/** Vehicle inventory update after delivery. Payload: { vehicleId, locationId, updates[] } */
export const ACTION_INVENTORY_UPDATE = 'inventory_update';
/** Cancel sale order on Odoo when back online. Payload: { saleOrderId, reason, cancelledAt? } */
export const ACTION_CANCEL_ORDER = 'order_cancel';

function wakePendingUploadAfterQueueChange() {
  Promise.all([import('../services/sync.service.js'), import('./syncQueue.js')])
    .then(async ([m, db]) => {
      const pending = await db.getPendingCount();
      if (pending <= 0) return;
      const indicators =
        typeof m.hasDashboardUploadIndicators === 'function' ? m.hasDashboardUploadIndicators() : false;
      if (pending <= 0 && !indicators) return;
      if (typeof m.schedulePendingUploadSync === 'function') {
        m.schedulePendingUploadSync({ immediate: true, aggressive: true, queuePasses: 16 });
      }
    })
    .catch(() => {});
}

export async function enqueue(actionType, payload) {
  const db = await getDb();
  let payloadObj = payload;
  if (actionType === ACTION_DELIVERY && payload != null && typeof payload === 'object') {
    payloadObj = await ensureDeliveryTxnOnPayload(payload);
  }
  const payloadStr =
    typeof payloadObj === 'string'
      ? payloadObj
      : JSON.stringify(payloadObj ?? {}, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
  await db.runAsync(
    'INSERT INTO sync_queue (action_type, payload, created_at, is_uploaded) VALUES (?, ?, ?, 0)',
    [empty(actionType) || 'unknown', payloadStr, iso()]
  );
  const row = await db.getFirstAsync('SELECT last_insert_rowid() AS id');
  wakePendingUploadAfterQueueChange();
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

/** Held rows wait for payment/complete — not actionable until released in sync.service. */
export function isSyncQueuePayloadHeld(payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  return p.holdUntilPayment === true || p.holdUntilComplete === true;
}

/** Pending queue rows that can actually upload now (excludes held delivery/inventory/payment). */
export async function getActionablePendingCount() {
  const db = await getDb();
  const rows = await db.getAllAsync(
    'SELECT payload FROM sync_queue WHERE COALESCE(is_uploaded, 0) = 0 AND synced_at IS NULL'
  );
  let count = 0;
  for (const row of rows || []) {
    const payload = safeParseJson(row.payload, {});
    if (!isSyncQueuePayloadHeld(payload)) count += 1;
  }
  return count;
}

/** Age in ms of the oldest pending queue row (0 when queue empty). */
export async function getOldestPendingQueueAgeMs() {
  const db = await getDb();
  const row = await db.getFirstAsync(
    'SELECT MIN(created_at) AS oldest FROM sync_queue WHERE COALESCE(is_uploaded, 0) = 0 AND synced_at IS NULL'
  );
  const oldest = row?.oldest;
  if (!oldest) return 0;
  const t = Date.parse(String(oldest));
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Date.now() - t);
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

/** Sale order ids with a payment row still waiting to upload (used to avoid clearing checkout resume too early). */
export async function getPendingPaymentSaleOrderIds() {
  const db = await getDb();
  const rows = await db.getAllAsync(
    `SELECT payload FROM sync_queue WHERE action_type = ? AND COALESCE(is_uploaded, 0) = 0 AND synced_at IS NULL`,
    [ACTION_PAYMENT]
  );
  const ids = new Set();
  for (const row of rows || []) {
    const p = safeParseJson(row.payload, {});
    const soId = p.saleOrderId ?? p.sale_order_id;
    if (soId != null) {
      const n = Number(soId);
      if (Number.isFinite(n)) ids.add(n);
    }
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

/** Pending cancel row for a sale order (latest id if duplicates). */
export async function getPendingCancelItemBySaleOrderId(saleOrderId) {
  if (saleOrderId == null) return null;
  const db = await getDb();
  const rows = await db.getAllAsync(
    `SELECT id, payload FROM sync_queue WHERE action_type = ? AND COALESCE(is_uploaded, 0) = 0 AND synced_at IS NULL`,
    [ACTION_CANCEL_ORDER]
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
function isDeliveryPayloadShape(payload) {
  if (payload == null || typeof payload !== 'object') return false;
  return (
    Array.isArray(payload.pickings) ||
    payload.pickingId != null ||
    Array.isArray(payload.saleOrderLineDeliveredUpdates) ||
    payload.demandEdit === true ||
    Array.isArray(payload.orderLineUpdates)
  );
}

export async function updateQueueItemPayload(id, payload, options = {}) {
  const db = await getDb();
  let payloadObj = payload;
  if (
    options.actionType === ACTION_DELIVERY ||
    (typeof payload === 'object' && isDeliveryPayloadShape(payload))
  ) {
    payloadObj = await ensureDeliveryTxnOnPayload(payload);
  }
  const payloadStr =
    typeof payloadObj === 'string'
      ? payloadObj
      : JSON.stringify(payloadObj ?? {}, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
  await db.runAsync('UPDATE sync_queue SET payload = ? WHERE id = ?', [payloadStr, num(id)]);
  if (options.suppressWake !== true) {
    wakePendingUploadAfterQueueChange();
  }
}

/** Actionable pending rows for one sale order (excludes held until payment/complete). */
export async function getActionablePendingCountForSaleOrder(saleOrderId) {
  const soId = Number(saleOrderId);
  if (!Number.isFinite(soId) || soId <= 0) return 0;
  const rows = await getPending();
  let count = 0;
  for (const row of rows || []) {
    const payload = row.payload || {};
    const rowSo = Number(payload.saleOrderId ?? payload.sale_order_id);
    if (rowSo !== soId) continue;
    if (!isSyncQueuePayloadHeld(payload)) count += 1;
  }
  return count;
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

/** Synced payment timestamps for many sale orders (avoids N+1 queue scans on invoice lists). */
export async function getPaymentSyncedAtMapBySaleOrderIds(saleOrderIds) {
  if (!Array.isArray(saleOrderIds) || saleOrderIds.length === 0) return {};
  const wanted = new Set(
    saleOrderIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)
  );
  if (wanted.size === 0) return {};
  const db = await getDb();
  const rows = await db.getAllAsync(
    `SELECT payload, synced_at FROM sync_queue WHERE action_type = ? AND (COALESCE(is_uploaded, 0) = 1 OR synced_at IS NOT NULL)`,
    [ACTION_PAYMENT]
  );
  const out = {};
  for (const row of rows || []) {
    const p = safeParseJson(row.payload, {});
    const id = Number(p.saleOrderId ?? p.sale_order_id);
    if (!Number.isFinite(id) || !wanted.has(id) || !row.synced_at) continue;
    out[id] = row.synced_at;
  }
  return out;
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

/**
 * Synced payment queue rows whose sale-order chatter (payment / gas / empty notes) was not posted yet.
 * Used after fast-drain or early mark-synced paths so text messages are not lost while photos still upload.
 */
export async function getSyncedPaymentItemsMissingCheckoutChatter() {
  const db = await getDb();
  const rows = await db.getAllAsync(
    `SELECT id, payload FROM sync_queue
     WHERE action_type = ?
       AND (COALESCE(is_uploaded, 0) = 1 OR synced_at IS NOT NULL)
     ORDER BY id DESC`,
    [ACTION_PAYMENT]
  );
  const latestBySo = new Map();
  for (const row of rows || []) {
    const p = safeParseJson(row.payload, {});
    const soId = Number(p.saleOrderId ?? p.sale_order_id);
    if (!Number.isFinite(soId) || soId <= 0) continue;
    if (!latestBySo.has(soId)) {
      latestBySo.set(soId, { id: row.id, payload: p, saleOrderId: soId });
    }
  }
  const out = [];
  for (const row of latestBySo.values()) {
    if (row?.payload?._paymentProofChatterPosted === true) continue;
    out.push(row);
  }
  return out;
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
