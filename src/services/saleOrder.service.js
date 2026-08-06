import { callOdoo, callOdooArgs, callOdooArgsKwargs } from "./index.service";

/**
 * Fields requested from sale.order search_read.
 * Standard Odoo sale.order does NOT have payment_type or amount_credit; payment method
 * (cash/cheque/credit) is derived from invoices + account.payment in refreshPaymentTypesFromOdoo.
 * If your Odoo has custom fields (e.g. payment_type, amount_credit, x_payment_type),
 * add them here so they are returned when present.
 */
const SALE_ORDER_FIELDS = [
  "id",
  "name",
  "partner_id",
  "state",
  "date_order",
  "commitment_date",
  "amount_total",
  "amount_untaxed",
  "amount_tax",
  "invoice_status",
  "order_line",
  "route_id",
  "vehicle_id",
  "invoice_number",
];

/** Custom / studio fields on sale.order (GasTech): used for dashboard payment split on a fresh device after sync. */
const SALE_ORDER_OPTIONAL_PAYMENT_FIELDS = [
  "payment_type",
  "amount_cash",
  "amount_cheque",
  "amount_credit",
];

const SALE_ORDER_FIELDS_WITH_PAYMENT = [...SALE_ORDER_FIELDS, ...SALE_ORDER_OPTIONAL_PAYMENT_FIELDS];

function isUnknownFieldOdooError(err) {
  const m = String(err?.message || err || "").toLowerCase();
  return (
    m.includes("field") &&
    (m.includes("invalid") || m.includes("unknown") || m.includes("does not exist") || m.includes("undefined"))
  );
}

const CANCEL_REASON_FALLBACKS = [
  { value: 'shop_closed', label: 'Shop closed' },
  { value: 'customer_not_available', label: 'Customer not available' },
  { value: 'customer_cancelled', label: 'Customer cancelled' },
  { value: 'wrong_order', label: 'Wrong order' },
  { value: 'duplicate_order', label: 'Duplicate order' },
  { value: 'other', label: 'Other' },
];

function resolveDateField(syncDateField) {
  return syncDateField === 'delivery_date' ? 'commitment_date' : 'date_order';
}

function resolveDateValue(dateFrom) {
  if (!dateFrom) return null;
  return String(dateFrom).includes(' ') ? String(dateFrom) : `${dateFrom} 00:00:00`;
}

/**
 * Odoo excludes False/null on `commitment_date >= X`. When syncing by delivery date,
 * also include orders with empty commitment_date whose date_order falls in the window.
 */
function buildDateWindowDomain(syncDateField, dateValue) {
  if (!dateValue) return [];
  if (syncDateField === 'delivery_date') {
    return [
      '|',
      ['commitment_date', '>=', dateValue],
      '&',
      ['commitment_date', '=', false],
      ['date_order', '>=', dateValue],
    ];
  }
  return [['date_order', '>=', dateValue]];
}

/** Still-open assigned work — must sync even when commitment_date is empty or outside the history window. */
function buildOpenAssignedDomain(vehicleId = null) {
  const domain = [
    ['state', '!=', 'cancel'],
    ['invoice_status', '!=', 'invoiced'],
  ];
  if (vehicleId != null) {
    domain.unshift(['vehicle_id', '=', vehicleId]);
  }
  return domain;
}

function mergeSaleOrdersById(...lists) {
  const byId = new Map();
  for (const list of lists) {
    for (const row of list || []) {
      const id = Number(row?.id);
      if (!Number.isFinite(id) || id <= 0) continue;
      byId.set(id, row);
    }
  }
  return Array.from(byId.values());
}

async function searchReadSaleOrders(domain, opts) {
  try {
    return await callOdoo('sale.order', 'search_read', [domain], {
      ...opts,
      fields: SALE_ORDER_FIELDS_WITH_PAYMENT,
    });
  } catch (e) {
    if (!isUnknownFieldOdooError(e)) throw e;
    return await callOdoo('sale.order', 'search_read', [domain], {
      ...opts,
      fields: SALE_ORDER_FIELDS,
    });
  }
}

/**
 * Get ALL sale orders (with invoice_status for list display)
 * @param {string} dateFrom - Optional ISO date string (e.g., "2024-03-13") to filter orders from this date onward
 * @param {'creation_date'|'delivery_date'} syncDateField - Filter and sort field selector from sync settings
 */
export const getAllSaleOrders = async (dateFrom, syncDateField = 'creation_date', maxRows = 500) => {
  const dateField = resolveDateField(syncDateField);
  const dateValue = resolveDateValue(dateFrom);
  const safeLimit = Math.min(1000, Math.max(50, Number(maxRows) || 500));
  const opts = {
    order: `${dateField} desc, id desc`,
    limit: safeLimit,
  };

  // No cutoff: single pull is enough.
  if (!dateValue) {
    return searchReadSaleOrders([], opts);
  }

  // Dual pull: date window (null-safe for delivery date) + all still-open assigned orders.
  const [windowOrders, openOrders] = await Promise.all([
    searchReadSaleOrders(buildDateWindowDomain(syncDateField, dateValue), opts),
    searchReadSaleOrders(buildOpenAssignedDomain(null), opts),
  ]);
  return mergeSaleOrdersById(windowOrders, openOrders);
};

function normalizeReasonSelection(selection) {
  if (!Array.isArray(selection) || selection.length === 0) return [];
  return selection
    .map((item) => {
      if (!Array.isArray(item) || item.length < 1) return null;
      const [value, label] = item;
      return { value: String(value), label: String(label || value) };
    })
    .filter(Boolean);
}

/** Fetch reasons from Odoo wizard field (online only). */
export async function fetchCancellationReasonOptionsFromOdoo() {
  const fields = await callOdoo(
    'sale.order.cancel.reason.wizard',
    'fields_get',
    [],
    {
      allfields: ['reason'],
      attributes: ['string', 'type', 'required', 'selection'],
    }
  );
  return normalizeReasonSelection(fields?.reason?.selection);
}

/**
 * Pull Odoo wizard reasons into SQLite (call on login / sync while online).
 */
export async function refreshCancellationReasonsCache() {
  try {
    const reasons = await fetchCancellationReasonOptionsFromOdoo();
    if (reasons.length > 0) {
      const { replaceCancellationReasons } = await import('../database/cancellationReasons.js');
      await replaceCancellationReasons(reasons);
      return reasons;
    }
  } catch (error) {
    console.warn('[saleOrder.service] refreshCancellationReasonsCache', error?.message ?? error);
  }
  return null;
}

/**
 * Cancel modal + offline cancel: SQLite only — never calls Odoo (same labels as back office).
 */
export async function getStoredCancellationReasonsForUI() {
  const { getCancellationReasonsFromDb } = await import('../database/cancellationReasons.js');
  const stored = await getCancellationReasonsFromDb();
  if (stored.length > 0) return stored;
  return [];
}

/** @deprecated Use getStoredCancellationReasonsForUI for modals. Online refresh via refreshCancellationReasonsCache. */
export const getCancellationReasonOptions = async () => {
  const stored = await getStoredCancellationReasonsForUI();
  if (stored.length > 0) return stored;
  try {
    const fresh = await refreshCancellationReasonsCache();
    if (Array.isArray(fresh) && fresh.length > 0) return fresh;
  } catch (_) {
    /* non-fatal */
  }
  const again = await getStoredCancellationReasonsForUI();
  return again.length > 0 ? again : CANCEL_REASON_FALLBACKS;
};
/**
 * Cancel sale order(s) on Odoo with reason (GasTech action_cancel_with_reason).
 * Tries kwargs + positional shapes used across Odoo / custom module versions.
 */
export async function cancelSaleOrderWithReason(orderId, reason, context = {}) {
  const ids = (Array.isArray(orderId) ? orderId : [orderId])
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0);
  if (!ids.length) throw new Error('Invalid sale order id');
  const reasonStr = String(reason || '').trim();
  if (!reasonStr) throw new Error('Cancel reason is required');
  const ctx = {
    lang: 'en_US',
    active_model: 'sale.order',
    active_ids: ids,
    ...context,
  };

  const attempts = [
    () =>
      callOdooArgsKwargs('sale.order', 'action_cancel_with_reason', [], {
        ids,
        reason: reasonStr,
        context: ctx,
      }),
    () =>
      callOdooArgsKwargs('sale.order', 'action_cancel_with_reason', [ids], {
        reason: reasonStr,
        context: ctx,
      }),
    () => callOdooArgs('sale.order', 'action_cancel_with_reason', [ids, reasonStr]),
    () => callOdooArgs('sale.order', 'action_cancel_with_reason', [[ids], reasonStr]),
  ];

  let lastErr = null;
  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (e) {
      lastErr = e;
    }
  }

  try {
    await callOdoo('sale.order', 'action_cancel', [ids]);
    return true;
  } catch (fallbackErr) {
    throw lastErr || fallbackErr;
  }
}

/** True when Odoo sale.order is already cancelled. */
export async function isSaleOrderCancelledOnOdoo(saleOrderId) {
  const soId = Number(saleOrderId);
  if (!Number.isFinite(soId) || soId <= 0) return false;
  try {
    const rows =
      (await callOdoo('sale.order', 'read', [[soId]], { fields: ['id', 'state'] })) || [];
    const st = String((Array.isArray(rows) ? rows[0] : rows)?.state || '').toLowerCase();
    return st === 'cancel';
  } catch (_) {
    return false;
  }
}
/**
 * Get sale orders for a specific vehicle only (for vehicle-scoped sync).
 *
 * Uses a dual pull so vehicles never lose assigned work:
 * 1) Date-window history (delivery-date mode treats empty commitment_date via date_order)
 * 2) All still-open / non-invoiced orders for this vehicle (matches back-office "assigned")
 *
 * @param {number} vehicleId - The vehicle ID to filter by
 * @param {string} dateFrom - Optional ISO date string (e.g., "2024-03-13") to filter orders from this date onward
 * @param {'creation_date'|'delivery_date'} syncDateField - Filter and sort field selector from sync settings
 */
export const getSaleOrdersByVehicle = async (vehicleId, dateFrom, syncDateField = 'creation_date', maxRows = 500) => {
  const dateField = resolveDateField(syncDateField);
  const dateValue = resolveDateValue(dateFrom);
  const safeLimit = Math.min(1000, Math.max(50, Number(maxRows) || 500));
  const opts = {
    order: `${dateField} desc, id desc`,
    limit: safeLimit,
  };

  if (!dateValue) {
    return searchReadSaleOrders([['vehicle_id', '=', vehicleId]], opts);
  }

  const historyDomain = [['vehicle_id', '=', vehicleId], ...buildDateWindowDomain(syncDateField, dateValue)];
  const [historyOrders, openOrders] = await Promise.all([
    searchReadSaleOrders(historyDomain, opts),
    searchReadSaleOrders(buildOpenAssignedDomain(vehicleId), opts),
  ]);
  return mergeSaleOrdersById(historyOrders, openOrders);
};

/**
 * Get total quantity (sum of product_uom_qty) per order for given order line ids.
 * Returns { orderId: totalQty }.
 */
export const getOrderLineTotalsForOrders = async (orders) => {
  const lineIds = [];
  (orders || []).forEach((o) => {
    const ids = o.order_line;
    if (Array.isArray(ids)) lineIds.push(...ids);
  });
  if (lineIds.length === 0) return {};

  const lines = await callOdoo(
    "sale.order.line",
    "search_read",
    [[["id", "in", lineIds]]],
    { fields: ["order_id", "product_uom_qty"] }
  );
  const byOrder = {};
  (lines || []).forEach((line) => {
    const orderId = Array.isArray(line.order_id) ? line.order_id[0] : line.order_id;
    const qty = Number(line.product_uom_qty) || 0;
    byOrder[orderId] = (byOrder[orderId] || 0) + qty;
  });
  return byOrder;
};
