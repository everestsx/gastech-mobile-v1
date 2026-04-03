// services/employee.service.js — hr.employee: same shape as Odoo search_read (barcode + department_id, etc.)
import { callOdoo, callOdooJson2 } from "./index.service";

/** Matches Postman / Odoo: driver row with barcode, pin, image, department. */
const FIELDS_DRIVER_API = ["id", "name", "barcode", "pin", "image_1920", "department_id"];

const FIELDS_MINIMAL = ["id", "name", "image_1920"];

const CONTEXT = { lang: "en_US" };

export class DriverLookupError extends Error {
  /** @param {'not_driving'} kind */
  constructor(kind, message) {
    super(message);
    this.name = "DriverLookupError";
    this.kind = kind;
  }
}

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
 * search_read hr.employee — same endpoint as Postman: `/json/2/hr.employee/search_read` (Bearer) first.
 * JSON-RPC often returns [] for the same API user (record rules) without throwing, so we never reached JSON 2 before.
 */
async function employeeSearchRead(domain, { limit = 500, fields } = {}) {
  const flds = fields?.length ? fields : FIELDS_MINIMAL;

  const json2Params = (fieldList) => ({
    domain,
    fields: fieldList,
    limit,
    context: CONTEXT,
  });

  const attempt = async (fieldList) => {
    const params = json2Params(fieldList);
    try {
      const result = await callOdooJson2("hr.employee", "search_read", params);
      const arr = Array.isArray(result) ? result : [];
      return arr;
    } catch (j2Err) {
      if (__DEV__) {
        console.warn("[employee] JSON2 search_read failed, trying JSON-RPC:", j2Err?.message || j2Err);
      }
    }
    const opts = { fields: fieldList, limit, context: CONTEXT };
    try {
      const rows = await callOdoo("hr.employee", "search_read", [domain], opts);
      return Array.isArray(rows) ? rows : [];
    } catch (rpcErr) {
      if (!isAccessLikeError(rpcErr)) throw rpcErr;
      const result = await callOdooJson2("hr.employee", "search_read", params);
      return Array.isArray(result) ? result : [];
    }
  };

  try {
    return await attempt(flds);
  } catch (e) {
    const stripped = flds.filter((f) => f !== "barcode" && f !== "pin");
    if (stripped.length && stripped.length < flds.length) {
      try {
        return await attempt(stripped);
      } catch {
        return [];
      }
    }
    throw e;
  }
}

async function trySearch(domain, limit, fields = FIELDS_MINIMAL) {
  try {
    const rows = await employeeSearchRead(domain, { limit, fields });
    return Array.isArray(rows) ? rows : [];
  } catch (e) {
    if (__DEV__) {
      console.warn("[employee.service] domain skipped:", JSON.stringify(domain), e?.message || e);
    }
    return [];
  }
}

function departmentName(row) {
  const d = row?.department_id;
  if (d == null || d === false) return "";
  return Array.isArray(d) ? String(d[1] ?? "").trim() : String(d).trim();
}

function isDrivingDepartment(row) {
  const n = departmentName(row).toLowerCase();
  return n === "driving" || n.includes("driving");
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
 * @param {object} row
 * @param {string} [enteredDriverCode] — fallback if server omits barcode (ACL-safe read)
 */
export function normalizeEmployee(row, enteredDriverCode = "") {
  if (!row || row.id == null) return null;
  const entered = String(enteredDriverCode || "").trim();
  const fromServer = row.barcode != null && row.barcode !== false ? String(row.barcode).trim() : "";
  return {
    id: row.id,
    name: row.name || "",
    barcode: fromServer || entered,
    imageBase64: row.image_1920 != null && row.image_1920 !== false ? String(row.image_1920) : null,
  };
}

const DEPT_EXACT = ["department_id.name", "=", "Driving"];
const DEPT_FUZZY = ["department_id.name", "ilike", "%Driving%"];
const PORTERS_EXACT = ["department_id.name", "=", "Porters"];
const PORTERS_FUZZY = ["department_id.name", "ilike", "%Porters%"];

function pickUnique(rows, trimmed) {
  if (!rows?.length) return null;
  if (rows.length === 1) return normalizeEmployee(rows[0], trimmed);
  return null;
}

/**
 * Primary path (Postman parity): domain [["barcode", "=", code]], then keep only Driving employees using `department_id`.
 * Fallbacks: PIN / barcode with department in domain, identification_id, global unique pin/barcode.
 */
export const getDriverByBarcode = async (driverCode) => {
  const trimmed = typeof driverCode === "string" ? driverCode.trim() : String(driverCode ?? "").trim();
  if (!trimmed) return null;

  // 1) Exact API you use in Postman: barcode only, full fields
  const byBarcode = await trySearch([["barcode", "=", trimmed]], 10, FIELDS_DRIVER_API);
  const drivingFromBarcode = byBarcode.filter(isDrivingDepartment);
  if (drivingFromBarcode.length >= 1) {
    return normalizeEmployee(drivingFromBarcode[0], trimmed);
  }
  if (byBarcode.length >= 1) {
    throw new DriverLookupError(
      "not_driving",
      "This barcode is not assigned to a Driving employee. Ask your administrator."
    );
  }

  const pinEq = ["pin", "=", trimmed];
  const pinIlike = ["pin", "ilike", trimmed];
  const barcodeEq = ["barcode", "=", trimmed];
  const barcodeIlike = ["barcode", "ilike", trimmed];
  const identEq = ["identification_id", "=", trimmed];
  const identIlike = ["identification_id", "ilike", trimmed];

  const attempts = [
    [[DEPT_EXACT, pinEq], 1],
    [[DEPT_EXACT, pinIlike], 1],
    [[DEPT_FUZZY, pinEq], 1],
    [[DEPT_FUZZY, pinIlike], 1],
    [[DEPT_EXACT, barcodeEq], 1],
    [[DEPT_EXACT, barcodeIlike], 1],
    [[DEPT_FUZZY, barcodeEq], 1],
    [[DEPT_FUZZY, barcodeIlike], 1],
    [[DEPT_EXACT, identEq], 1],
    [[DEPT_EXACT, identIlike], 1],
    [[DEPT_FUZZY, identEq], 1],
    [[DEPT_FUZZY, identIlike], 1],
  ];

  for (const [domain, limit] of attempts) {
    const rows = await trySearch(domain, limit, FIELDS_MINIMAL);
    const one = pickUnique(rows, trimmed);
    if (one) return one;
  }

  const pinGlobal = await trySearch([pinEq], 2, FIELDS_MINIMAL);
  const pinPick = pickUnique(pinGlobal, trimmed);
  if (pinPick) return pinPick;

  const barcodeGlobal = await trySearch([barcodeEq], 2, FIELDS_DRIVER_API);
  const drivingGlobal = barcodeGlobal.filter(isDrivingDepartment);
  if (drivingGlobal.length === 1) return normalizeEmployee(drivingGlobal[0], trimmed);

  const barcodePick = pickUnique(barcodeGlobal, trimmed);
  if (barcodePick) return barcodePick;

  return null;
};

/** All employees in the Driving department (exact or fuzzy name). */
export const getDrivingEmployees = async () => {
  let rows = await trySearch([DEPT_EXACT], 500, FIELDS_MINIMAL);
  if (!rows.length) rows = await trySearch([DEPT_FUZZY], 500, FIELDS_MINIMAL);
  return rows.map((r) => normalizeEmployee(r)).filter(Boolean);
};

/** Porters: same field set as your Odoo search_read (domain on Porters department). */
export const getPortersEmployees = async () => {
  let rows = await trySearch([PORTERS_EXACT], 500, FIELDS_DRIVER_API);
  if (!rows.length) rows = await trySearch([PORTERS_FUZZY], 500, FIELDS_DRIVER_API);
  return rows.map((r) => normalizeEmployee(r)).filter(Boolean);
};
