/**
 * Shared rules for “delivery done” / progress (dashboard, charts, lists).
 */

import { isSaleOrderDeliveredInUi } from './completedOrderUi';

/** Cylinder qty delivered on one SO line (Odoo qty_delivered; full ordered qty only when invoiced and no partial qty on file). */
export function effectiveDeliveredQtyForLine(line, { isInvoiced = false } = {}) {
  const qd = Number(line?.qty_delivered) || 0;
  if (qd > 0.000001) return qd;
  const ordered = Number(line?.product_uom_qty) || 0;
  if (isInvoiced && ordered > 0) return ordered;
  return 0;
}

/**
 * Dashboard Delivery Progress bar: delivered shops use actual delivered qty;
 * shops still to deliver use ordered qty as pending.
 */
export function chartProgressQtyForLine(line, { isDone = false, isInvoiced = false } = {}) {
  const orderedQty = Math.round(Number(line?.product_uom_qty) || 0);
  const deliveredQty = Math.round(effectiveDeliveredQtyForLine(line, { isInvoiced }));
  if (isDone) {
    const q = deliveredQty > 0 ? deliveredQty : orderedQty;
    return { stack: q, delivered: q, pending: 0 };
  }
  if (orderedQty <= 0) return { stack: 0, delivered: 0, pending: 0 };
  return { stack: orderedQty, delivered: 0, pending: orderedQty };
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
 * Same picking merge as the Orders tab: a Done picking wins; a leftover Cancelled
 * remainder must not hide a still-assigned delivery (dashboard counters were treating
 * cancel as complete after back-office pull).
 */
export function ordersTabPickingStateBySaleId(pickings) {
  const map = {};
  (pickings || []).forEach((p) => {
    const saleId = Array.isArray(p?.sale_id) ? p.sale_id[0] : p?.sale_id;
    if (saleId == null) return;
    if (String(p.state || '').toLowerCase() === 'done') map[saleId] = 'done';
    else if (String(map[saleId] || '').toLowerCase() !== 'done') map[saleId] = p.state;
  });
  return map;
}

/** True when this order would still appear on the Orders tab (not qty_done / qty_delivered). */
export function orderIsOpenOnOrdersTab(order, pickingState, resumeEntry) {
  if (isSaleOrderDeliveredInUi(Number(order?.id))) return false;
  if (String(order?.state || '') === 'cancel') return false;
  if (resumeEntry?.invoiceParams || resumeEntry?.phase === 'payment') return true;
  const inv = String(order?.invoice_status || '').toLowerCase() === 'invoiced';
  const st = String(pickingState || '').toLowerCase();
  return !(inv || st === 'done' || st === 'cancel');
}

/** Completed for dashboard cards / progress bars — same rule as Orders tab, not reserved qty. */
export function orderIsCompletedLikeOrdersTab(order, pickingState, pendingCheckoutSaleOrderIds) {
  if (String(order?.state || '') === 'cancel') return false;
  const oid = Number(order?.id);
  const resume =
    pendingCheckoutSaleOrderIds instanceof Set && Number.isFinite(oid) && pendingCheckoutSaleOrderIds.has(oid)
      ? { phase: 'payment' }
      : null;
  const pickSt =
    pickingState && typeof pickingState === 'object' && !Array.isArray(pickingState)
      ? pickingState[order?.id] ?? pickingState[oid] ?? ''
      : pickingState;
  return !orderIsOpenOnOrdersTab(order, pickSt, resume);
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
