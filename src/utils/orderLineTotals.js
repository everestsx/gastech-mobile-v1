/**
 * Header `sale_orders.amount_total` can lag behind line `price_total` after local qty edits
 * (especially when delivery qty changes without a full "Modify order" save). Prefer summing lines
 * for display so cards match printed invoice totals.
 */

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
