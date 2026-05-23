/**
 * Frozen invoice line snapshot — local history must not drift after Odoo sync overwrites sale_order_lines.
 */
import * as localInvoicesDb from '../database/localInvoices.js';
import * as saleOrderLinesDb from '../database/saleOrderLines.js';
import { num } from '../database/dbHelpers.js';
import { lineSubtotalAtQuantity, lineTaxAtQuantity } from './orderLineTax.js';

function roundQty3(q) {
  return Math.round(Number(q) * 1000) / 1000;
}

function lineProductId(line) {
  const raw = line?.product_id;
  return Array.isArray(raw) ? Number(raw[0]) : Number(raw);
}

/**
 * Build immutable invoice lines from driver qty rows + current SQLite lines.
 * @param {number} saleOrderId
 * @param {Array<{ lineId?: number, qty?: number }>} invoiceLineQtys
 * @param {object[]} orderLines — sale_order_lines rows from DB
 */
export function buildInvoiceLineSnapshot(saleOrderId, invoiceLineQtys = [], orderLines = []) {
  const soId = num(saleOrderId);
  if (!soId) return [];
  const qtyByLineId = new Map();
  for (const row of invoiceLineQtys || []) {
    const lid = num(row?.lineId);
    const q = roundQty3(row?.qty);
    if (lid > 0 && Number.isFinite(q) && q >= 0) qtyByLineId.set(lid, q);
  }

  const out = [];
  for (const line of orderLines || []) {
    const lineId = num(line?.id);
    if (!lineId) continue;
    const productId = lineProductId(line);
    if (!Number.isFinite(productId) || productId <= 0) continue;

    const ordered = Number(line?.product_uom_qty) || 0;
    const overrideQty = qtyByLineId.has(lineId) ? qtyByLineId.get(lineId) : null;
    const qty = overrideQty != null ? overrideQty : roundQty3(line?.qty_delivered ?? ordered);
    if (qty <= 0 && ordered <= 0) continue;

    const origQ = ordered > 0 ? ordered : qty;
    let price_subtotal;
    let price_total;
    if (origQ > 0 && overrideQty != null) {
      const scale = qty / origQ;
      price_subtotal = (Number(line.price_subtotal) || 0) * scale;
      price_total = (Number(line.price_total) || 0) * scale;
    } else {
      price_subtotal = lineSubtotalAtQuantity(line, qty);
      const tax = lineTaxAtQuantity(line, qty);
      price_total = price_subtotal + tax;
    }

    const productName = Array.isArray(line?.product_id)
      ? String(line.product_id[1] || '').trim()
      : String(line?.product_name || line?.name || '').trim();

    out.push({
      lineId,
      productId,
      productName: productName || String(line?.name || '').trim(),
      name: String(line?.name || productName || '').trim(),
      qty: roundQty3(qty),
      qty_delivered: roundQty3(qty),
      price_unit: Number(line?.price_unit) || 0,
      price_subtotal: roundQty3(price_subtotal),
      price_total: roundQty3(price_total),
    });
  }
  return out;
}

export function parseInvoiceLineSnapshot(raw) {
  if (raw == null || raw === '') return null;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    return parsed
      .map((row) => ({
        lineId: num(row?.lineId),
        productId: num(row?.productId),
        productName: String(row?.productName || row?.name || '').trim(),
        name: String(row?.name || row?.productName || '').trim(),
        qty: roundQty3(row?.qty ?? row?.qty_delivered),
        qty_delivered: roundQty3(row?.qty_delivered ?? row?.qty),
        price_unit: Number(row?.price_unit) || 0,
        price_subtotal: Number(row?.price_subtotal) || 0,
        price_total: Number(row?.price_total) || 0,
      }))
      .filter((r) => r.lineId > 0 && r.productId > 0);
  } catch (_) {
    return null;
  }
}

/** Persist snapshot JSON on local_invoices (does not create invoice row). */
export async function saveInvoiceLineSnapshot(saleOrderId, snapshot) {
  const soId = num(saleOrderId);
  if (!soId || !Array.isArray(snapshot) || snapshot.length === 0) return false;
  return localInvoicesDb.updateLocalInvoiceLineSnapshot(soId, snapshot);
}

/** Write snapshot lines into sale_order_lines so lists/history match invoice. */
export async function applyInvoiceLineSnapshotToSaleOrderLines(saleOrderId, snapshot) {
  const soId = num(saleOrderId);
  const rows = Array.isArray(snapshot) ? snapshot : [];
  if (!soId || rows.length === 0) return;
  for (const row of rows) {
    const lineId = num(row?.lineId);
    const qty = roundQty3(row?.qty ?? row?.qty_delivered);
    if (lineId <= 0) continue;
    await saleOrderLinesDb.updateSaleOrderLineQtyLocal(lineId, qty);
    await saleOrderLinesDb.updateSaleOrderLineQtyDeliveredLocal(lineId, qty);
  }
}

export async function getInvoiceLineSnapshotForSaleOrder(saleOrderId) {
  const inv = await localInvoicesDb.getLocalInvoiceBySaleOrderId(saleOrderId);
  if (!inv?.line_snapshot_json) return null;
  return parseInvoiceLineSnapshot(inv.line_snapshot_json);
}

/**
 * Finalize local invoice lines from payment queue invoiceLineQtys + current DB lines.
 */
export async function finalizeLocalInvoiceSnapshotFromPayment(soId, invoiceLineQtys) {
  const id = num(soId);
  if (!id) return;
  const lines = await saleOrderLinesDb.getSaleOrderLinesByOrderIds([id]);
  const snapshot = buildInvoiceLineSnapshot(id, invoiceLineQtys, lines);
  if (snapshot.length === 0) return;
  await saveInvoiceLineSnapshot(id, snapshot);
  await applyInvoiceLineSnapshotToSaleOrderLines(id, snapshot);
}

/** Map snapshot rows to InvoiceScreen line shape. */
/** After payment sync, align frozen snapshot with Odoo sale.order.line (local history = back office). */
export async function refreshInvoiceLineSnapshotFromOdoo(saleOrderId) {
  const soId = num(saleOrderId);
  if (!soId) return;
  const inv = await localInvoicesDb.getLocalInvoiceBySaleOrderId(soId);
  if (!inv?.id) return;
  try {
    const { callOdoo } = await import('../services/index.service.js');
    const rows = await callOdoo('sale.order.line', 'search_read', [[['order_id', '=', soId]]], {
      fields: [
        'id',
        'product_id',
        'name',
        'product_uom_qty',
        'qty_delivered',
        'price_unit',
        'price_subtotal',
        'price_total',
      ],
      limit: 200,
    });
    const snapshot = [];
    for (const r of rows || []) {
      const lineId = num(r?.id);
      const productId = Array.isArray(r?.product_id) ? num(r.product_id[0]) : num(r?.product_id);
      if (lineId <= 0 || productId <= 0) continue;
      const qty = roundQty3(r?.qty_delivered ?? r?.product_uom_qty);
      if (qty <= 0 && (Number(r?.product_uom_qty) || 0) <= 0) continue;
      snapshot.push({
        lineId,
        productId,
        productName: Array.isArray(r?.product_id) ? String(r.product_id[1] || '').trim() : '',
        name: String(r?.name || '').trim(),
        qty,
        qty_delivered: qty,
        price_unit: Number(r?.price_unit) || 0,
        price_subtotal: roundQty3(r?.price_subtotal),
        price_total: roundQty3(r?.price_total),
      });
    }
    if (snapshot.length === 0) return;
    await saveInvoiceLineSnapshot(soId, snapshot);
    await applyInvoiceLineSnapshotToSaleOrderLines(soId, snapshot);
  } catch (e) {
    console.warn('[localInvoiceSnapshot] refresh from Odoo', e?.message || e);
  }
}

export function snapshotRowsToInvoiceLines(saleOrderId, snapshot) {
  const soId = num(saleOrderId);
  return (snapshot || []).map((row) => ({
    id: row.lineId,
    order_id: [soId, null],
    product_id: [row.productId, row.productName || row.name || '—'],
    name: row.name || row.productName || '',
    product_uom_qty: row.qty,
    price_unit: row.price_unit,
    price_subtotal: row.price_subtotal,
    price_total: row.price_total,
    qty_delivered: row.qty_delivered ?? row.qty,
  }));
}
