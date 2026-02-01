import { callOdoo } from "./index.service";

export const getSaleOrderDelivery = (saleOrderId) =>
  callOdoo(
    "stock.picking",
    "search_read",
    [[["sale_id", "=", saleOrderId]]],
    {
      fields: ["id", "name", "state"],
      limit: 1,
    }
  );
