/**
 * Persisted delivery quantity audit trail (mobile vs payload vs Odoo).
 * Used to detect and diagnose qty corruption before it affects stock/invoices.
 */
import { getDb } from './db.js';
import { empty, num, iso } from './dbHelpers.js';

function safeJson(obj) {
  try {
    return JSON.stringify(obj ?? null);
  } catch (_) {
    return 'null';
  }
}

/**
 * @param {object} entry
 * @param {number} [entry.queueItemId]
 * @param {number} [entry.saleOrderId]
 * @param {string} [entry.deliveryTxnId]
 * @param {string} entry.phase — pre_sync | post_apply | post_finalize | rejected
 * @param {string} entry.status — pending | success | rejected | error
 * @param {object} [entry.mobileQty]
 * @param {object} [entry.payloadQty]
 * @param {object} [entry.odooQty]
 * @param {string} [entry.errorMessage]
 */
export async function recordDeliveryQtyAudit(entry = {}) {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO delivery_qty_audit (
      queue_item_id, sale_order_id, delivery_txn_id, phase, status,
      mobile_qty_json, payload_qty_json, odoo_qty_json, error_message, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.queueItemId != null ? num(entry.queueItemId) : null,
      entry.saleOrderId != null ? num(entry.saleOrderId) : null,
      empty(entry.deliveryTxnId),
      empty(entry.phase) || 'unknown',
      empty(entry.status) || 'unknown',
      safeJson(entry.mobileQty),
      safeJson(entry.payloadQty),
      safeJson(entry.odooQty),
      entry.errorMessage != null ? String(entry.errorMessage).slice(0, 2000) : null,
      iso(),
    ]
  );
}

export async function getRecentDeliveryQtyAudits(saleOrderId, limit = 20) {
  const soId = num(saleOrderId);
  if (!soId) return [];
  const db = await getDb();
  const rows = await db.getAllAsync(
    `SELECT id, queue_item_id, sale_order_id, delivery_txn_id, phase, status,
            mobile_qty_json, payload_qty_json, odoo_qty_json, error_message, created_at
     FROM delivery_qty_audit
     WHERE sale_order_id = ?
     ORDER BY id DESC
     LIMIT ?`,
    [soId, Math.max(1, Math.min(limit, 100))]
  );
  return (rows || []).map((r) => ({
    id: r.id,
    queueItemId: r.queue_item_id,
    saleOrderId: r.sale_order_id,
    deliveryTxnId: r.delivery_txn_id,
    phase: r.phase,
    status: r.status,
    mobileQty: safeParse(r.mobile_qty_json),
    payloadQty: safeParse(r.payload_qty_json),
    odooQty: safeParse(r.odoo_qty_json),
    errorMessage: r.error_message,
    createdAt: r.created_at,
  }));
}

function safeParse(s) {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch (_) {
    return null;
  }
}
