// services/employee.service.js — hr.employee (Driving / Porters); avoid reading `barcode` (Odoo field ACL).
import { callOdoo, callOdooJson2 } from "./index.service";

/** Fields safe for portal-style users; do not include `barcode` (requires HR Officer in many DBs). */
const EMPLOYEE_READ_FIELDS = ["id", "name", "image_1920", "mobile_phone", "work_phone"];

const CONTEXT = { lang: "en_US" };

const SEARCH_OPTS = {
  fields: EMPLOYEE_READ_FIELDS,
  limit: 500,
  context: CONTEXT,
};

function isAccessLikeError(err) {
  const m = String(err?.message || err || "").toLowerCase();
  return (
    m.includes("access") ||
    m.includes("rights") ||
    m.includes("permission") ||
    m.includes("barcode")
  );
}

/**
 * search_read on hr.employee: try JSON-RPC execute_kw, then JSON 2 (same pattern as commission).
 */
async function employeeSearchRead(domain, { limit = 500 } = {}) {
  const opts = { fields: EMPLOYEE_READ_FIELDS, limit, context: CONTEXT };
  try {
    const rows = await callOdoo("hr.employee", "search_read", [domain], opts);
    return Array.isArray(rows) ? rows : [];
  } catch (e) {
    if (!isAccessLikeError(e)) throw e;
    const result = await callOdooJson2("hr.employee", "search_read", {
      domain,
      fields: EMPLOYEE_READ_FIELDS,
      limit,
    });
    return Array.isArray(result) ? result : [];
  }
}

/**
 * Odoo `image_1920` is base64; returns a data URI suitable for React Native `Image` `source={{ uri }}`.
 */
export function odooImageToUri(imageField) {
  if (imageField == null || imageField === false) return null;
  const s = String(imageField).trim();
  if (!s) return null;
  if (s.startsWith("data:")) return s;
  return `data:image/png;base64,${s}`;
}

/**
 * @param {object} row — Odoo record (no barcode field required)
 * @param {string} [enteredDriverCode] — value the driver typed (stored as driver id / “password” for session)
 */
/** Prefer mobile, then work phone — always a string for session / SQLite (never null). */
function pickEmployeePhone(row) {
  if (!row) return "";
  for (const k of ["mobile_phone", "work_phone"]) {
    const v = row[k];
    if (v == null || typeof v === "object") continue;
    const s = String(v).trim();
    if (s && s.toLowerCase() !== "false") return s;
  }
  return "";
}

export function normalizeEmployee(row, enteredDriverCode = "") {
  if (!row || row.id == null) return null;
  const entered = String(enteredDriverCode || "").trim();
  return {
    id: row.id,
    name: row.name || "",
    barcode: entered,
    imageBase64: row.image_1920 != null && row.image_1920 !== false ? String(row.image_1920) : null,
    phone: pickEmployeePhone(row),
  };
}

/** All employees in the Driving department. */
export const getDrivingEmployees = () =>
  employeeSearchRead([["department_id.name", "=", "Driving"]], { limit: 500 }).then((rows) =>
    rows.map((r) => normalizeEmployee(r)).filter(Boolean)
  );

/** All employees in the Porters department (multi-select on login). */
export const getPortersEmployees = () =>
  employeeSearchRead([["department_id.name", "=", "Porters"]], { limit: 500 }).then((rows) =>
    rows.map((r) => normalizeEmployee(r)).filter(Boolean)
  );

/**
 * Find a driver by the code they enter (often stored in Odoo `barcode` on the employee).
 * We match using a domain on `barcode` but only read id, name, image (no barcode field read → no ACL error).
 */
export const getDriverByBarcode = async (driverCode) => {
  const trimmed = typeof driverCode === "string" ? driverCode.trim() : String(driverCode ?? "").trim();
  if (!trimmed) return null;

  const baseDomain = [
    ["department_id.name", "=", "Driving"],
    ["barcode", "=", trimmed],
  ];

  let rows = await employeeSearchRead(baseDomain, { limit: 1 });
  if (!rows.length) {
    rows = await employeeSearchRead(
      [
        ["department_id.name", "=", "Driving"],
        ["barcode", "ilike", trimmed],
      ],
      { limit: 1 }
    );
  }

  if (!rows.length) return null;
  return normalizeEmployee(rows[0], trimmed);
};
