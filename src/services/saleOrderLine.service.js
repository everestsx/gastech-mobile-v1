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
 * Aggregated ordered vs delivered qty per product on a sale order — used to cancel zombie backorder pickings
 * (moves still demand stock but SO is already fully fulfilled).
 */
export async function readSaleOrderLineQtyAggregatesByProduct(saleOrderId) {
  const soId = Number(saleOrderId);
  if (!Number.isFinite(soId) || soId <= 0) {
    return { orderedByProduct: new Map(), deliveredByProduct: new Map() };
  }
  const rows = await callOdoo(
    "sale.order.line",
    "search_read",
    [[["order_id", "=", soId]]],
    { fields: ["product_id", "product_uom_qty", "qty_delivered"], limit: 250 }
  );
  const orderedByProduct = new Map();
  const deliveredByProduct = new Map();
  for (const r of rows || []) {
    const pid = Array.isArray(r.product_id) ? r.product_id[0] : r.product_id;
    if (pid == null || !Number.isFinite(Number(pid))) continue;
    const p = Number(pid);
    orderedByProduct.set(p, (orderedByProduct.get(p) || 0) + (Number(r.product_uom_qty) || 0));
    deliveredByProduct.set(p, (deliveredByProduct.get(p) || 0) + (Number(r.qty_delivered) || 0));
  }
  return { orderedByProduct, deliveredByProduct };
}

/** Read current qty_delivered on SO lines from Odoo (for pre-invoice reconciliation vs mobile snapshot). */
export async function readSaleOrderLinesDeliveredSnapshot(lineIds) {
  const ids = Array.from(
    new Set(
      (lineIds || [])
        .map((id) => Number(id))
        .filter((n) => Number.isFinite(n) && n > 0)
    )
  );
  const out = new Map();
  if (ids.length === 0) return out;
  const rows = await callOdoo("sale.order.line", "read", [ids], { fields: ["id", "qty_delivered"] });
  for (const r of rows || []) {
    if (r?.id != null) out.set(Number(r.id), Number(r.qty_delivered) || 0);
  }
  return out;
}

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
