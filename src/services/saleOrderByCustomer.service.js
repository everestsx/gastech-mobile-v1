import { callOdoo } from "./index.service";

/**
 * Get today's Sale Order for a customer
 * Assumption: ONE sale order per customer per day
 */
export const getTodaySaleOrderByCustomer = async (customerId) => {
//   const today = new Date().toISOString().split("T")[0];

  const orders = await callOdoo(
    "sale.order",
    "search_read",
    [
      [
        ["partner_id", "=", customerId],
        ["state", "!=", "cancel"],
      ],
    ],
    {
      fields: ["id", "name"],
      limit: 1,
      order: "date_order desc",
    }
  );

  return orders.length ? orders[0] : null;
};
