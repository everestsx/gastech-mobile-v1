/**
 * Shared rules for “delivery done” / progress (dashboard, charts, lists).
 */

export function mergePickingStateBySaleIdFromRows(pickings) {
  const map = {};
  (pickings || []).forEach((p) => {
    const sid = Array.isArray(p?.sale_id) ? p.sale_id[0] : p?.sale_id;
    if (sid == null) return;
    const ps = String(p.state || '').toLowerCase();
    const cur = String(map[sid] || '').toLowerCase();
    if (ps === 'done' || cur === 'done') map[sid] = 'done';
    else if (ps === 'cancel' || cur === 'cancel') map[sid] = 'cancel';
    else map[sid] = p.state;
  });
  return map;
}

/**
 * Delivery-complete for UI: invoiced, picking done/cancel, any qty_done on move lines, or any Odoo qty_delivered on SO lines.
 * @param {Set<number>} [saleOrderIdsWithBackendQtyDelivered] - from DB after sync (partial delivery from backend without local move lines yet).
 */
export function orderIsDeliveryDoneForProgress(
  order,
  pickingStateBySaleIdMap,
  qtyDoneBySaleIdMap,
  saleOrderIdsWithBackendQtyDelivered
) {
  const oid = Number(order?.id);
  if (
    saleOrderIdsWithBackendQtyDelivered instanceof Set &&
    Number.isFinite(oid) &&
    saleOrderIdsWithBackendQtyDelivered.has(oid)
  ) {
    return true;
  }
  if (String(order?.invoice_status || '').toLowerCase() === 'invoiced') return true;
  const st = String(pickingStateBySaleIdMap[order?.id] || '').toLowerCase();
  if (st === 'done' || st === 'cancel') return true;
  if ((Number(qtyDoneBySaleIdMap[order?.id]) || 0) > 0) return true;
  return false;
}
