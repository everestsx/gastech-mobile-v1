import { lineTaxAtQuantity } from './orderLineTax.js';

/** Mirror offline SQLite line price recompute after qty change (instant UI). */
export function linePricesAfterQtyChange(line, newQty) {
  const qtyNum = Number(newQty) || 0;
  const priceUnit = Number(line?.price_unit) || 0;
  const priceSubtotal = qtyNum * priceUnit;
  const oldSubtotal = Number(line?.price_subtotal) || 0;
  const oldTotal = Number(line?.price_total) || 0;
  const oldQty = Number(line?.product_uom_qty) || 0;
  const lineTax = oldTotal - oldSubtotal;
  let priceTotal;
  if (oldSubtotal > 0) {
    priceTotal = priceSubtotal * (1 + Math.max(0, lineTax / oldSubtotal));
  } else if (oldQty > 0 && lineTax > 0) {
    priceTotal = priceSubtotal + (lineTax / oldQty) * qtyNum;
  } else {
    priceTotal = priceSubtotal + lineTaxAtQuantity(line, qtyNum);
  }
  return {
    product_uom_qty: qtyNum,
    price_subtotal: priceSubtotal,
    price_total: priceTotal,
  };
}

export function orderAmountsFromLines(lines = []) {
  let amountUntaxed = 0;
  let amountTax = 0;
  for (const l of lines) {
    amountUntaxed += Number(l.price_subtotal) || 0;
    amountTax += (Number(l.price_total) || 0) - (Number(l.price_subtotal) || 0);
  }
  return {
    amount_untaxed: amountUntaxed,
    amount_tax: amountTax,
    amount_total: amountUntaxed + amountTax,
  };
}

/** Apply saved qty + recalculated prices to line rows for immediate UI refresh. */
export function linesAfterDemandEditSave(lines, orderLineUpdates = []) {
  const updByLineId = new Map(
    (orderLineUpdates || []).map((u) => [Number(u.lineId), Number(u.product_uom_qty)])
  );
  return (lines || []).map((l) => {
    const lineId = Number(l.id);
    if (!updByLineId.has(lineId)) {
      const qty = Number(l.newQty) || Number(l.product_uom_qty) || 0;
      return { ...l, newQty: String(qty) };
    }
    const qty = updByLineId.get(lineId);
    const prices = linePricesAfterQtyChange(l, qty);
    return {
      ...l,
      ...prices,
      newQty: String(qty),
    };
  });
}
