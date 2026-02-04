import { callOdoo } from "./index.service";

const SALE_ORDER_FIELDS = [
  "id",
  "name",
  "partner_id",
  "state",
  "date_order",
  "amount_total",
  "invoice_status",
  "route_id",
  "vehicle_id",
  "order_line",
];

/**
 * Get ALL sale orders (for sync/cache). Filter by vehicle is done in sync layer.
 */
export const getAllSaleOrders = () =>
  callOdoo("sale.order", "search_read", [[]], {
    fields: SALE_ORDER_FIELDS,
    order: "date_order desc",
    limit: 100,
  });
