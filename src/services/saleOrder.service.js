import { callOdoo } from "./index.service";

/**
 * Get ALL sale orders (with invoice_status for list display)
 */
export const getAllSaleOrders = () =>
  callOdoo(
    "sale.order",
    "search_read",
    [[]],
    {
      fields: [
        "id",
        "name",
        "partner_id",
        "state",
        "date_order",
        "amount_total",
        "invoice_status",
        "order_line",
        "route_id",
        "vehicle_id",
      ],
      order: "date_order desc",
      limit: 50,
    }
  );

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
