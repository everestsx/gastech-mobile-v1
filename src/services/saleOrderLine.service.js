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

/* ---------------- UPDATE SALE ORDER LINE QTY (ordered qty — Modify/Save only, not delivery flow) ---------------- */
export const updateSaleOrderLineQty = (lineId, qty) =>
  callOdoo("sale.order.line", "write", [[lineId], { product_uom_qty: qty }]);

/** Delivered qty on SO line (do not change ordered qty). May fail on some Odoo configs if field is computed — caller should catch. */
export const updateSaleOrderLineQtyDelivered = (lineId, qtyDelivered) =>
  callOdoo("sale.order.line", "write", [[lineId], { qty_delivered: Number(qtyDelivered) }]);

/**
 * Apply multiple sale.order.line updates in one Odoo write (single DB transaction on server).
 * ordered: [{ lineId, product_uom_qty }]
 * delivered: [{ lineId, qty_delivered }]
 */
export const applySaleOrderLineUpdatesBatch = async (saleOrderId, { ordered = [], delivered = [] } = {}) => {
  const soId = Number(saleOrderId);
  if (!Number.isFinite(soId) || soId <= 0) return;
  const orderLineCommands = [];
  for (const u of ordered || []) {
    if (u?.lineId == null || u?.product_uom_qty == null) continue;
    orderLineCommands.push([1, Number(u.lineId), { product_uom_qty: Number(u.product_uom_qty) }]);
  }
  for (const u of delivered || []) {
    if (u?.lineId == null || u?.qty_delivered == null) continue;
    orderLineCommands.push([1, Number(u.lineId), { qty_delivered: Number(u.qty_delivered) }]);
  }
  if (!orderLineCommands.length) return;
  await callOdoo("sale.order", "write", [[soId], { order_line: orderLineCommands }]);
};

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
