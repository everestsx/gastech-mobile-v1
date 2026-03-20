import { callOdoo } from "./index.service";

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

/**
 * Get ALL sale orders (with invoice_status for list display)
 * @param {string} dateFrom - Optional ISO date string (e.g., "2024-03-13") to filter orders from this date onward
 */
export const getAllSaleOrders = (dateFrom) => {
  const domain = dateFrom ? [['date_order', '>=', dateFrom]] : [];
  return callOdoo(
    "sale.order",
    "search_read",
    [domain],
    {
      fields: SALE_ORDER_FIELDS,
      order: "date_order desc",
      limit: 500,
    }
  );
};

/**
 * Get sale orders for a specific vehicle only (for vehicle-scoped sync).
 * @param {number} vehicleId - The vehicle ID to filter by
 * @param {string} dateFrom - Optional ISO date string (e.g., "2024-03-13") to filter orders from this date onward
 */
export const getSaleOrdersByVehicle = (vehicleId, dateFrom) => {
  const domain = [['vehicle_id', '=', vehicleId]];
  if (dateFrom) {
    domain.push(['date_order', '>=', dateFrom]);
  }
  return callOdoo(
    "sale.order",
    "search_read",
    [domain],
    {
      fields: SALE_ORDER_FIELDS,
      order: "date_order desc",
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
