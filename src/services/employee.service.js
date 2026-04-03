// services/employee.service.js — hr.employee (Driving / Porters); read only id, name, image (no barcode/pin in response).
import { callOdoo, callOdooJson2 } from "./index.service";

const EMPLOYEE_READ_FIELDS = ["id", "name", "image_1920"];

const CONTEXT = { lang: "en_US" };

function isAccessLikeError(err) {
  const m = String(err?.message || err || "").toLowerCase();
  return (
    m.includes("access") ||
    m.includes("rights") ||
    m.includes("permission") ||
    m.includes("barcode") ||
    m.includes('"pin"') ||
    m.includes("'pin'")
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

/** One strategy must not break the whole login if a field (e.g. pin) is missing on older Odoo. */
async function trySearch(domain, limit) {
  try {
    const rows = await employeeSearchRead(domain, { limit });
    return Array.isArray(rows) ? rows : [];
  } catch (e) {
    if (__DEV__) {
      console.warn("[employee.service] domain skipped:", JSON.stringify(domain), e?.message || e);
    }
    return [];
  }
}

/** Department = exact "Driving" or name containing "Driving" (handles "Fleet / Driving", etc.). */
const DEPT_EXACT = ["department_id.name", "=", "Driving"];
const DEPT_FUZZY = ["department_id.name", "ilike", "%Driving%"];

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
 * @param {object} row — Odoo record
 * @param {string} [enteredDriverCode] — value the driver typed (stored for session / settings)
 */
export function normalizeEmployee(row, enteredDriverCode = "") {
  if (!row || row.id == null) return null;
  const entered = String(enteredDriverCode || "").trim();
  return {
    id: row.id,
    name: row.name || "",
    barcode: entered,
    imageBase64: row.image_1920 != null && row.image_1920 !== false ? String(row.image_1920) : null,
  };
}

function pickUnique(rows, trimmed) {
  if (!rows?.length) return null;
  if (rows.length === 1) return normalizeEmployee(rows[0], trimmed);
  return null;
}

/**
 * Match driver login code against Odoo without reading protected fields.
 * Order: PIN (Attendance / HR kiosk) → barcode → identification_id, with strict then fuzzy department, then global unique PIN/barcode.
 */
export const getDriverByBarcode = async (driverCode) => {
  const trimmed = typeof driverCode === "string" ? driverCode.trim() : String(driverCode ?? "").trim();
  if (!trimmed) return null;

  const pinEq = ["pin", "=", trimmed];
  const pinIlike = ["pin", "ilike", trimmed];
  const barcodeEq = ["barcode", "=", trimmed];
  const barcodeIlike = ["barcode", "ilike", trimmed];
  const identEq = ["identification_id", "=", trimmed];
  const identIlike = ["identification_id", "ilike", trimmed];

  const attempts = [
    // PIN + department (most likely for a short code like D1)
    [[DEPT_EXACT, pinEq], 1, "pin+dept"],
    [[DEPT_EXACT, pinIlike], 1, "pin+dept-ilike"],
    [[DEPT_FUZZY, pinEq], 1, "pin+fuzzy-dept"],
    [[DEPT_FUZZY, pinIlike], 1, "pin+fuzzy-dept-ilike"],
    // Barcode + department
    [[DEPT_EXACT, barcodeEq], 1, "barcode+dept"],
    [[DEPT_EXACT, barcodeIlike], 1, "barcode+dept-ilike"],
    [[DEPT_FUZZY, barcodeEq], 1, "barcode+fuzzy-dept"],
    [[DEPT_FUZZY, barcodeIlike], 1, "barcode+fuzzy-dept-ilike"],
    // Employee ID / badge number text
    [[DEPT_EXACT, identEq], 1, "ident+dept"],
    [[DEPT_EXACT, identIlike], 1, "ident+dept-ilike"],
    [[DEPT_FUZZY, identEq], 1, "ident+fuzzy-dept"],
    [[DEPT_FUZZY, identIlike], 1, "ident+fuzzy-dept-ilike"],
  ];

  for (const [domain, limit] of attempts) {
    const rows = await trySearch(domain, limit);
    const one = pickUnique(rows, trimmed);
    if (one) return one;
  }

  // Last resort: code unique company-wide on pin or barcode (no department filter)
  const pinGlobal = await trySearch([pinEq], 2);
  const pinPick = pickUnique(pinGlobal, trimmed);
  if (pinPick) return pinPick;

  const barcodeGlobal = await trySearch([barcodeEq], 2);
  const barcodePick = pickUnique(barcodeGlobal, trimmed);
  if (barcodePick) return barcodePick;

  return null;
};

/** All employees in the Driving department (exact or fuzzy name). */
export const getDrivingEmployees = async () => {
  let rows = await trySearch([DEPT_EXACT], 500);
  if (!rows.length) rows = await trySearch([DEPT_FUZZY], 500);
  return rows.map((r) => normalizeEmployee(r)).filter(Boolean);
};

/** All employees in the Porters department. */
export const getPortersEmployees = async () => {
  let rows = await trySearch([["department_id.name", "=", "Porters"]], 500);
  if (!rows.length) rows = await trySearch([["department_id.name", "ilike", "%Porters%"]], 500);
  return rows.map((r) => normalizeEmployee(r)).filter(Boolean);
};
