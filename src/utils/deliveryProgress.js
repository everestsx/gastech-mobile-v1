/**
 * Shared rules for “delivery done” / progress (dashboard, charts, lists).
 */

/** Cylinder qty delivered on one SO line (Odoo qty_delivered; full ordered qty only when invoiced and no partial qty on file). */
export function effectiveDeliveredQtyForLine(line, { isInvoiced = false } = {}) {
  const qd = Number(line?.qty_delivered) || 0;
  if (qd > 0.000001) return qd;
  const ordered = Number(line?.product_uom_qty) || 0;
  if (isInvoiced && ordered > 0) return ordered;
  return 0;
}

export function sumEffectiveDeliveredQtyForOrder(order, orderLines) {
  const oid = Number(order?.id);
  if (!Number.isFinite(oid)) return 0;
  const isInvoiced = String(order?.invoice_status || '').toLowerCase() === 'invoiced';
  let sum = 0;
  for (const line of orderLines || []) {
    const lineOid = Array.isArray(line.order_id) ? line.order_id[0] : line.order_id;
    if (Number(lineOid) !== oid) continue;
    sum += effectiveDeliveredQtyForLine(line, { isInvoiced });
  }
  return sum;
}

/**
 * Dashboard / stock: order counts as delivered when backend or local activity exists — not every cached “invoiced” header alone.
 */
export function orderCountsAsDeliveredForDashboard(
  order,
  pickingStateBySaleIdMap,
  qtyDoneBySaleIdMap,
  saleOrderIdsWithBackendQtyDelivered,
  pendingCheckoutSaleOrderIds,
  localInvoicedSaleOrderIds,
  orderLines
) {
  const oid = Number(order?.id);
  if (
    pendingCheckoutSaleOrderIds instanceof Set &&
    Number.isFinite(oid) &&
    pendingCheckoutSaleOrderIds.has(oid)
  ) {
    return false;
  }
  if (
    saleOrderIdsWithBackendQtyDelivered instanceof Set &&
    Number.isFinite(oid) &&
    saleOrderIdsWithBackendQtyDelivered.has(oid)
  ) {
    return true;
  }
  if ((Number(qtyDoneBySaleIdMap[order?.id]) || 0) > 0) return true;
  const st = String(pickingStateBySaleIdMap[order?.id] || '').toLowerCase();
  if (st === 'done' || st === 'cancel') return true;
  if (
    localInvoicedSaleOrderIds instanceof Set &&
    Number.isFinite(oid) &&
    localInvoicedSaleOrderIds.has(oid)
  ) {
    return true;
  }
  return sumEffectiveDeliveredQtyForOrder(order, orderLines) > 0.000001;
}

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
 * @param {Set<number>} [pendingCheckoutSaleOrderIds] - checkout not completed; never treat as delivered for lists/dashboard.
 */
export function orderIsDeliveryDoneForProgress(
  order,
  pickingStateBySaleIdMap,
  qtyDoneBySaleIdMap,
  saleOrderIdsWithBackendQtyDelivered,
  pendingCheckoutSaleOrderIds
) {
  const oid = Number(order?.id);
  if (
    pendingCheckoutSaleOrderIds instanceof Set &&
    Number.isFinite(oid) &&
    pendingCheckoutSaleOrderIds.has(oid)
  ) {
    return false;
  }
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

/**
 * Delivered Orders tab: completed work the driver should see here (not only strict SQLite invoice_status).
 * - Invoiced locally or on cached Odoo header, or
 * - Payment queue row already synced (mobile completion uploaded), or
 * - Same delivery signals as dashboard (picking done / qty_done / Odoo qty_delivered / invoiced).
 * Checkout in progress (resume) is always excluded.
 */
export function orderAppearsInDeliveredTab(
  order,
  pickingStateBySaleIdMap,
  qtyDoneBySaleIdMap,
  saleOrderIdsWithBackendQtyDelivered,
  pendingCheckoutSaleOrderIds,
  localInvoicedSaleOrderIds,
  syncedPaymentSaleOrderIds
) {
  const oid = Number(order?.id);
  if (
    pendingCheckoutSaleOrderIds instanceof Set &&
    Number.isFinite(oid) &&
    pendingCheckoutSaleOrderIds.has(oid)
  ) {
    return false;
  }
  const odooInvoiced = String(order?.invoice_status || '').toLowerCase() === 'invoiced';
  const localInvoiced =
    localInvoicedSaleOrderIds instanceof Set && Number.isFinite(oid) && localInvoicedSaleOrderIds.has(oid);
  if (odooInvoiced || localInvoiced) return true;
  if (
    syncedPaymentSaleOrderIds instanceof Set &&
    Number.isFinite(oid) &&
    syncedPaymentSaleOrderIds.has(oid)
  ) {
    return true;
  }
  return orderIsDeliveryDoneForProgress(
    order,
    pickingStateBySaleIdMap,
    qtyDoneBySaleIdMap,
    saleOrderIdsWithBackendQtyDelivered,
    pendingCheckoutSaleOrderIds
  );
}
