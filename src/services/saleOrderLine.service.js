import { callOdoo } from "./index.service";

const SALE_ORDER_DETAIL_FIELDS = [
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
  "amount_untaxed",
  "amount_tax",
];

const SALE_ORDER_LINE_FIELDS = [
  "id",
  "order_id",
  "product_id",
  "name",
  "product_uom_qty",
  "price_unit",
  "price_subtotal",
  "price_total",
];

/* ---------------- GET SALE ORDER DETAILS (search_read) ---------------- */
export const getSaleOrderDetails = async (saleOrderId) => {
  const orders = await callOdoo(
    "sale.order",
    "search_read",
    [[["id", "=", saleOrderId]]],
    {
      fields: SALE_ORDER_DETAIL_FIELDS,
      limit: 20,
      order: "date_order desc",
    }
  );
  const order = orders?.[0] ?? null;
  if (!order) return { order: null, lines: [] };

  let lines = [];
  const orderLineIds = order.order_line ?? [];
  if (orderLineIds.length) {
    lines = await callOdoo(
      "sale.order.line",
      "search_read",
      [[["id", "in", orderLineIds]]],
      {
        fields: SALE_ORDER_LINE_FIELDS,
        limit: 100,
      }
    );
  }

  return { order, lines };
};

/* ---------------- UPDATE SALE ORDER LINE QTY (order line product_uom_qty) ---------------- */
export const updateSaleOrderLineQty = (lineId, qty) =>
  callOdoo("sale.order.line", "write", [[lineId], { product_uom_qty: qty }]);

/* ---------------- GET PAYMENT JOURNALS (bank and cash only, from Odoo) ---------------- */
export const getJournals = () =>
  callOdoo(
    "account.journal",
    "search_read",
    [[["type", "in", ["cash", "bank"]]]],
    { fields: ["id", "name", "code", "type"], order: "name asc" }
  );

/* ---------------- CONFIRM SALE ---------------- */
export const confirmSaleOrder = (orderId) =>
  callOdoo("sale.order", "action_confirm", [[orderId]]);
