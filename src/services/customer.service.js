// services/customer.service.js
import { callOdoo } from "./index.service";

const PARTNER_FIELDS = [
  "id",
  "name",
  "phone",
  "street",
  "street2",
  "city",
  "zip",
  "ref",
  "vat",
  "name_tamil",
  "name_sinhala",
];

const CUSTOMER_PAGE_SIZE = 500;
const CUSTOMER_FETCH_CAP = 50000;

export async function getAllCustomers(opts = {}) {
  const onProgress = typeof opts.onProgress === "function" ? opts.onProgress : null;
  const all = [];
  let offset = 0;
  while (offset < CUSTOMER_FETCH_CAP) {
    const batch = await callOdoo(
      "res.partner",
      "search_read",
      [[["customer_rank", ">", 0]]],
      {
        fields: PARTNER_FIELDS,
        limit: CUSTOMER_PAGE_SIZE,
        offset,
        order: "name ASC",
      }
    );
    const rows = Array.isArray(batch) ? batch : [];
    all.push(...rows);
    onProgress?.(all.length);
    if (rows.length < CUSTOMER_PAGE_SIZE) break;
    offset += CUSTOMER_PAGE_SIZE;
  }
  return all;
}

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
 * Fetch a single customer by reference code (res.partner.ref).
 * Returns the partner record or null if not found.
 */
export const getCustomerByRef = async (ref) => {
  const trimmed = typeof ref === "string" ? ref.trim() : String(ref ?? "").trim();
  if (!trimmed) return null;
  const partners = await callOdoo(
    "res.partner",
    "search_read",
    [
      [
        ["ref", "=", trimmed],
        ["customer_rank", ">", 0],
      ],
    ],
    {
      fields: ["id", "name", "ref", "phone", "street", "city"],
      limit: 1,
    }
  );
  return Array.isArray(partners) && partners.length > 0 ? partners[0] : null;
};

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
