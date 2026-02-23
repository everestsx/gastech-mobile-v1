// services/customer.service.js
import { callOdoo } from "./index.service";

const PARTNER_FIELDS = ["id", "name", "phone", "street", "street2", "city", "zip"];

export const getCustomers = () =>
  callOdoo(
    "res.partner",
    "search_read",
    [[["customer_rank", ">", 0]]],
    {
      fields: PARTNER_FIELDS,
      limit: 500,
    }
  );

/**
 * Fetch partners by ids (for vehicle-scoped sync: only partners that appear in this vehicle's orders).
 */
export const getPartnersByIds = (partnerIds) => {
  if (!partnerIds?.length) return Promise.resolve([]);
  const ids = [...new Set(partnerIds)].filter((id) => id != null);
  if (ids.length === 0) return Promise.resolve([]);
  return callOdoo(
    "res.partner",
    "search_read",
    [[["id", "in", ids]]],
    {
      fields: PARTNER_FIELDS,
      limit: ids.length + 10,
    }
  );
};
