import { callOdoo, callOdooArgs } from "./index.service";

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
  // Optional: add if your Odoo has these on sale.order (standard does not):
  // "amount_credit",
  // "payment_type",
  // "x_payment_type",
];

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
 * Get ALL sale orders (with invoice_status for list display)
 * @param {string} dateFrom - Optional ISO date string (e.g., "2024-03-13") to filter orders from this date onward
 * @param {'creation_date'|'delivery_date'} syncDateField - Filter and sort field selector from sync settings
 */
export const getAllSaleOrders = (dateFrom, syncDateField = 'creation_date') => {
  const dateField = resolveDateField(syncDateField);
  const dateValue = resolveDateValue(dateFrom);
  const domain = dateValue ? [[dateField, '>=', dateValue]] : [];
  return callOdoo(
    "sale.order",
    "search_read",
    [domain],
    {
      fields: SALE_ORDER_FIELDS,
      order: `${dateField} desc, id desc`,
      limit: 500,
    }
  );
};

/** Load backend cancellation reasons from the wizard selection field, with sensible fallback values. */
export const getCancellationReasonOptions = async () => {
  try {
    const fields = await callOdoo(
      'sale.order.cancel.reason.wizard',
      'fields_get',
      [],
      {
        allfields: ['reason'],
        attributes: ['string', 'type', 'required', 'selection'],
      }
    );
    const selection = fields?.reason?.selection;
    if (Array.isArray(selection) && selection.length > 0) {
      return selection
        .map((item) => {
          if (!Array.isArray(item) || item.length < 1) return null;
          const [value, label] = item;
          return { value: String(value), label: String(label || value) };
        })
        .filter(Boolean);
    }
  } catch (error) {
    console.warn('[saleOrder.service] getCancellationReasonOptions failed', error?.message ?? error);
  }
  return CANCEL_REASON_FALLBACKS;
};
/** Cancel a sale order with the selected reason code. */
export const cancelSaleOrderWithReason = (orderId, reason) =>
  callOdooArgs('sale.order', 'action_cancel_with_reason', [[Number(orderId)], String(reason || '')]);
/**
 * Get sale orders for a specific vehicle only (for vehicle-scoped sync).
 * @param {number} vehicleId - The vehicle ID to filter by
 * @param {string} dateFrom - Optional ISO date string (e.g., "2024-03-13") to filter orders from this date onward
 * @param {'creation_date'|'delivery_date'} syncDateField - Filter and sort field selector from sync settings
 */
export const getSaleOrdersByVehicle = (vehicleId, dateFrom, syncDateField = 'creation_date') => {
  const dateField = resolveDateField(syncDateField);
  const dateValue = resolveDateValue(dateFrom);
  const domain = [['vehicle_id', '=', vehicleId]];
  if (dateValue) {
    domain.push([dateField, '>=', dateValue]);
  }
  return callOdoo(
    "sale.order",
    "search_read",
    [domain],
    {
      fields: SALE_ORDER_FIELDS,
      order: `${dateField} desc, id desc`,
      limit: 500,
    }
  );
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
