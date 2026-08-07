/**
 * Local CRUD for sale_order_lines (Odoo sale.order.line mirror).
 */
import { getDb } from './db.js';
import { empty, num, numOrNull, iso } from './dbHelpers.js';
import { getProductsMap } from './products.js';
import { DEFAULT_LINE_VAT_RATE } from '../constants/tax.js';
import { parseInvoiceLineSnapshot } from '../utils/localInvoiceSnapshot.js';

function odooRel(idName) {
  if (Array.isArray(idName)) return { id: idName[0], name: idName[1] ?? null };
  return { id: idName, name: null };
}

/**
 * When a line has no stored subtotal/tax yet (typical if qty was 0), infer effective VAT rate from
 * other lines on the same order, then from cached sale order amounts.
 */
async function resolveLineTaxRateFallback(db, orderId, lineId) {
  const oid = num(orderId);
  const lid = num(lineId);
  if (!oid || !lid) return 0;
  const sib = await db.getFirstAsync(
    `SELECT COALESCE(SUM(price_subtotal), 0) AS sub_sum, COALESCE(SUM(price_total), 0) AS tot_sum
     FROM sale_order_lines WHERE order_id = ? AND id != ? AND price_subtotal > 0.000001`,
    [oid, lid]
  );
  const subSum = num(sib?.sub_sum);
  const totSum = num(sib?.tot_sum);
  if (subSum > 0) {
    const r = (totSum - subSum) / subSum;
    return Number.isFinite(r) && r >= 0 ? r : 0;
  }
  const ord = await db.getFirstAsync(
    'SELECT amount_untaxed, amount_tax FROM sale_orders WHERE id = ?',
    [oid]
  );
  const au = num(ord?.amount_untaxed);
  const at = num(ord?.amount_tax);
  if (au > 0) {
    const r = at / au;
    return Number.isFinite(r) && r >= 0 ? r : 0;
  }
  return 0;
}

/**
 * Upsert order lines from Odoo.
 * @param {object[]} rows
 * @param {{ preserveQtyForOrderIds?: Set<number> | number[] }} [options] - For these sale order ids, keep local qty/amounts if line exists (pending delivery/payment sync).
 */
export async function upsertSaleOrderLines(rows, options = {}) {
  if (!rows?.length) return;
  const rawPreserve = options.preserveQtyForOrderIds;
  const preserveSet =
    rawPreserve instanceof Set
      ? rawPreserve
      : new Set(Array.isArray(rawPreserve) ? rawPreserve.map((x) => num(x)).filter((n) => n > 0) : []);

  let localByLineId = new Map();
  const snapshotByLineId = new Map();
  if (preserveSet.size > 0) {
    const orderIds = Array.from(preserveSet);
    const localRows = await getSaleOrderLinesByOrderIds(orderIds);
    for (const lr of localRows || []) {
      if (lr?.id != null) localByLineId.set(num(lr.id), lr);
    }
    try {
      const localInvoicesDb = await import('./localInvoices.js');
      for (const oid of orderIds) {
        const inv = await localInvoicesDb.getLocalInvoiceBySaleOrderId(oid);
        const snap = parseInvoiceLineSnapshot(inv?.line_snapshot_json);
        if (!snap?.length) continue;
        for (const row of snap) {
          if (row.lineId > 0) snapshotByLineId.set(row.lineId, row);
        }
      }
    } catch (_) {
      /* non-fatal */
    }
  }

  const db = await getDb();
  const now = iso();
  await db.withTransactionAsync(async (tx) => {
    for (const r of rows) {
      const orderId = Array.isArray(r.order_id) ? r.order_id[0] : r.order_id;
      const orderIdNum = numOrNull(orderId);
      const lineId = num(r.id);
      const product = odooRel(r.product_id);

      let product_uom_qty = num(r.product_uom_qty);
      let price_unit = num(r.price_unit);
      let price_subtotal = num(r.price_subtotal);
      let price_total = num(r.price_total);
      let qty_delivered = num(r.qty_delivered);

      const frozen = snapshotByLineId.get(lineId);
      if (frozen != null) {
        product_uom_qty = num(frozen.qty);
        price_unit = num(frozen.price_unit);
        price_subtotal = num(frozen.price_subtotal);
        price_total = num(frozen.price_total);
        qty_delivered = num(frozen.qty_delivered ?? frozen.qty);
      } else if (orderIdNum != null && preserveSet.has(orderIdNum)) {
        const local = localByLineId.get(lineId);
        if (local != null) {
          product_uom_qty = num(local.product_uom_qty);
          price_unit = num(local.price_unit);
          price_subtotal = num(local.price_subtotal);
          price_total = num(local.price_total);
          const localQd = num(local.qty_delivered);
          const remoteQd = num(r.qty_delivered);
          qty_delivered = Number.isFinite(localQd) ? localQd : remoteQd;
        }
      }

      await tx.runAsync(
        `INSERT OR REPLACE INTO sale_order_lines (
          id, order_id, product_id, product_name, name, product_uom_qty,
          price_unit, price_subtotal, price_total, qty_delivered, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          lineId,
          orderIdNum,
          numOrNull(product.id),
          empty(product.name),
          empty(r.name),
          product_uom_qty,
          price_unit,
          price_subtotal,
          price_total,
          qty_delivered,
          now,
        ]
      );
    }
  });
}

export async function getSaleOrderLinesByOrderIds(orderIds) {
  if (!orderIds?.length) return [];
  const db = await getDb();
  const placeholders = orderIds.map(() => '?').join(',');
  const rows = await db.getAllAsync(
    `SELECT * FROM sale_order_lines WHERE order_id IN (${placeholders}) ORDER BY id`,
    orderIds
  );
  const productNames = await getProductsMap();
  return (rows || []).map((row) => {
    const productName = (row.product_name && String(row.product_name).trim()) || productNames[row.product_id] || '';
    return {
      id: row.id,
      order_id: [row.order_id, null],
      product_id: [row.product_id, productName],
      name: row.name,
      product_uom_qty: row.product_uom_qty,
      price_unit: row.price_unit,
      price_subtotal: row.price_subtotal,
      price_total: row.price_total,
      qty_delivered: row.qty_delivered != null ? num(row.qty_delivered) : 0,
    };
  });
}

/**
 * Sale order ids where Odoo has recorded delivered qty on at least one line (partial or full delivery from server).
 * @param {number[]} orderIds
 * @returns {Promise<Set<number>>}
 */
export async function getSaleOrderIdsWithPositiveQtyDelivered(orderIds) {
  const out = new Set();
  if (!Array.isArray(orderIds) || orderIds.length === 0) return out;
  const ids = [...new Set(orderIds.map((x) => num(x)).filter((n) => n > 0))];
  if (ids.length === 0) return out;
  const db = await getDb();
  const placeholders = ids.map(() => '?').join(',');
  const rows = await db.getAllAsync(
    `SELECT DISTINCT order_id FROM sale_order_lines
     WHERE order_id IN (${placeholders}) AND COALESCE(qty_delivered, 0) > 0.000001`,
    ids
  );
  for (const r of rows || []) {
    const oid = num(r.order_id);
    if (oid > 0) out.add(oid);
  }
  return out;
}

/**
 * Update one sale order line quantity locally (offline). Recomputes price_subtotal and price_total, preserving tax proportionally.
 */
/**
 * Update delivered qty on a sale order line locally (offline). Does not change ordered qty or prices.
 */
export async function updateSaleOrderLineQtyDeliveredLocal(lineId, qtyDelivered) {
  const db = await getDb();
  const q = num(qtyDelivered);
  await db.runAsync(
    `UPDATE sale_order_lines SET qty_delivered = ?, updated_at = ? WHERE id = ?`,
    [q, iso(), num(lineId)]
  );
}

export async function updateSaleOrderLineQtyLocal(lineId, qty) {
  const db = await getDb();
  const qtyNum = num(qty);
  const row = await db.getFirstAsync(
    'SELECT id, order_id, price_unit, price_subtotal, price_total, product_uom_qty FROM sale_order_lines WHERE id = ?',
    [num(lineId)]
  );
  if (!row) return;
  const orderId = numOrNull(row.order_id);
  const priceUnit = num(row.price_unit);
  const priceSubtotal = qtyNum * priceUnit;
  const oldSubtotal = num(row.price_subtotal);
  const oldTotal = num(row.price_total);
  const oldQty = num(row.product_uom_qty) || 0;
  const lineTax = oldTotal - oldSubtotal;
  let priceTotal;
  if (oldSubtotal > 0) {
    const taxRate = Math.max(0, lineTax / oldSubtotal);
    priceTotal = priceSubtotal * (1 + taxRate);
  } else if (oldQty > 0 && lineTax > 0) {
    const taxPerUnit = lineTax / oldQty;
    priceTotal = priceSubtotal + taxPerUnit * qtyNum;
  } else if (orderId != null) {
    const taxRateFallback = await resolveLineTaxRateFallback(db, orderId, lineId);
    const rate = taxRateFallback > 0 ? taxRateFallback : DEFAULT_LINE_VAT_RATE;
    priceTotal = priceSubtotal * (1 + rate);
  } else {
    priceTotal = priceSubtotal * (1 + DEFAULT_LINE_VAT_RATE);
  }
  await db.runAsync(
    `UPDATE sale_order_lines SET product_uom_qty = ?, price_subtotal = ?, price_total = ?, updated_at = ? WHERE id = ?`,
    [qtyNum, priceSubtotal, priceTotal, iso(), num(lineId)]
  );
}
