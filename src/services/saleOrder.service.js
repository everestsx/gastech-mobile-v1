import { callOdoo } from "./index.service";

/**
 * Get ALL sale orders
 */
export const getAllSaleOrders = () =>
  callOdoo(
    "sale.order",
    "search_read",
    [[]], // 👈 NO DOMAIN = ALL RECORDS
    {
      fields: [
        "id",
        "name",
        "partner_id",
        "state",
        "date_order",
        "amount_total",
      ],
      order: "date_order desc",
      limit: 50, // change if needed
    }
  );
