/**
 * Header `sale_orders.amount_total` can lag behind line `price_total` after local qty edits
 * (especially when delivery qty changes without a full "Modify order" save). Prefer summing lines
 * for display so cards match printed invoice totals.
 */

import { linePricesAfterQtyChange } from './saleOrderLinePricing.js';
import { effectiveDeliveredQtyForLine } from './deliveryProgress.js';

function lineProductId(line) {
  const raw = Array.isArray(line?.product_id) ? line.product_id[0] : line?.product_id;
  const n = Number(raw);
  return Number.isFinite(n) ? n : NaN;
}

export function sumOrderLinesPriceTotal(orderLines) {
  if (!Array.isArray(orderLines) || orderLines.length === 0) return null;
  let sum = 0;
  let counted = 0;
  for (const line of orderLines) {
    const pt = Number(line?.price_total);
    if (!Number.isFinite(pt)) continue;
    sum += pt;
    counted += 1;
  }
  return counted > 0 ? sum : null;
}

/**
 * @param {object} order - sale order row
 * @param {object[]} [orderLines] - optional lines for this order
 * @returns {number}
 */
export function getOrderDisplayTotal(order, orderLines) {
  const lineSum = sumOrderLinesPriceTotal(orderLines);
  const header = Number(order?.amount_total);
  if (lineSum != null && lineSum > 0) return lineSum;
  if (Number.isFinite(header) && header > 0) return header;
  return lineSum ?? (Number.isFinite(header) ? header : 0);
}

/**
 * Delivered tab: money for what was actually delivered (qty_delivered / qty_done),
 * not the original ordered line price_total. Falls back to header if no delivered qty.
 */
export function getOrderDeliveredDisplayTotal(order, orderLines, qtyByProductId = null) {
  const isInvoiced = String(order?.invoice_status || '').toLowerCase() === 'invoiced';
  const lines = Array.isArray(orderLines) ? orderLines : [];
  let sum = 0;
  let counted = 0;
  const productQtyUsed = {};
  for (const line of lines) {
    const pid = lineProductId(line);
    let qty = Number(line?.qty_delivered) || 0;
    if (qty <= 0 && qtyByProductId && Number.isFinite(pid)) {
      const remaining = Math.max(0, (Number(qtyByProductId[pid]) || 0) - (productQtyUsed[pid] || 0));
      qty = remaining;
    }
    if (qty <= 0) {
      qty = effectiveDeliveredQtyForLine(line, { isInvoiced });
    }
    if (qty <= 0) continue;
    if (Number.isFinite(pid)) {
      productQtyUsed[pid] = (productQtyUsed[pid] || 0) + qty;
    }
    const prices = linePricesAfterQtyChange(line, qty);
    const pt = Number(prices?.price_total);
    if (!Number.isFinite(pt)) continue;
    sum += pt;
    counted += 1;
  }
  if (counted > 0 && sum > 0) return sum;
  return getOrderDisplayTotal(order, lines);
}
