import { DEFAULT_LINE_VAT_RATE } from '../constants/tax.js';

/**
 * Untaxed line amount at qty (qty × unit price).
 */
export function lineSubtotalAtQuantity(line, qty) {
  const q = Number(qty) || 0;
  const unit = Number(line.price_unit) || 0;
  return q * unit;
}

/**
 * Tax portion for a line at a given qty (aligned with saleOrderLines.updateSaleOrderLineQtyLocal).
 * When Odoo has qty 0 and zero subtotal/tax, uses DEFAULT_LINE_VAT_RATE on (qty × unit).
 */
export function lineTaxAtQuantity(line, qty) {
  const q = Number(qty) || 0;
  const unit = Number(line.price_unit) || 0;
  const oldSub = Number(line.price_subtotal) || 0;
  const oldTot = Number(line.price_total) || 0;
  const oldQty = Number(line.product_uom_qty) || 0;
  const storedTax = oldTot - oldSub;
  const lineSubAtQ = q * unit;

  if (oldSub > 0) {
    const rate = Math.max(0, storedTax / oldSub);
    return lineSubAtQ * rate;
  }
  if (oldQty > 0 && storedTax > 0) {
    return (storedTax / oldQty) * q;
  }
  return lineSubAtQ * DEFAULT_LINE_VAT_RATE;
}
