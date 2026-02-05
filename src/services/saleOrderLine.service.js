import { callOdoo } from "./index.service";

/* ---------------- GET SALE ORDER DETAILS ---------------- */
export const getSaleOrderDetails = async (saleOrderId) => {
  const [order] = await callOdoo("sale.order", "read", [[saleOrderId]], {
    fields: [
      "id",
      "name",
      "partner_id",
      "state",
      "invoice_status",
      "amount_untaxed",
      "amount_tax",
      "amount_total",
      "order_line",
    ],
  });

  let lines = [];
  if (order.order_line?.length) {
    lines = await callOdoo("sale.order.line", "read", [order.order_line], {
      fields: [
        "id",
        "product_id",
        "product_uom_qty",
        "price_unit",
        "price_total",
      ],
    });
  }

  return { order, lines };
};

/** Fetch all order lines for given order IDs in one call (for offline cache). */
export const getSaleOrderLinesBatch = async (orderIds) => {
  if (!orderIds?.length) return [];
  const lines = await callOdoo("sale.order.line", "search_read", [[["order_id", "in", orderIds]]], {
    fields: ["id", "order_id", "product_id", "product_uom_qty", "price_unit", "price_total"],
    order: "order_id, id",
  });
  return Array.isArray(lines) ? lines : [];
};

/* ---------------- UPDATE QTY ---------------- */
export const updateSaleOrderLineQty = (lineId, qty) =>
  callOdoo("sale.order.line", "write", [[lineId], { product_uom_qty: qty }]);

/* ---------------- GET PAYMENT JOURNALS ---------------- */
export const getJournals = () =>
  callOdoo(
    "account.journal",
    "search_read",
    [[["type", "in", ["cash", "bank"]]]],
    { fields: ["id", "name", "type"] }
  );

/* ---------------- CONFIRM SALE ---------------- */
export const confirmSaleOrder = (orderId) =>
  callOdoo("sale.order", "action_confirm", [[orderId]]);
