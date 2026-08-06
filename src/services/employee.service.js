// services/employee.service.js — hr.employee (Driving / Porters); avoid reading `barcode` (Odoo field ACL).
import { callOdoo, callOdooJson2 } from "./index.service";

/** Fields safe for portal-style users; do not include `barcode` (requires HR Officer in many DBs). */
/**
 * Avatars render at most 96dp (ProfileModal), so image_512 is already generous even on
 * a 3x screen. image_1920 was ~400KB–2MB of base64 per person once encoded, which blew
 * past Android's ~2MB CursorWindow row limit when the driver plus porters were stored
 * together — that made the whole session unreadable, not just the photo.
 */
const EMPLOYEE_READ_FIELDS = ["id", "name", "image_512", "mobile_phone", "work_phone"];
const EMPLOYEE_READ_FIELDS_LIGHT = ["id", "name", "mobile_phone", "work_phone"];

const CONTEXT = { lang: "en_US" };
const PORTERS_CACHE_KEY = "@gastech_porters_cache_v1";
const PORTERS_CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

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
async function employeeSearchRead(domain, { limit = 500, fields = EMPLOYEE_READ_FIELDS } = {}) {
  const opts = { fields, limit, context: CONTEXT };
  try {
    const rows = await callOdoo("hr.employee", "search_read", [domain], opts);
    return Array.isArray(rows) ? rows : [];
  } catch (e) {
    if (!isAccessLikeError(e)) throw e;
    const result = await callOdooJson2("hr.employee", "search_read", {
      domain,
      fields,
      limit,
    });
    return Array.isArray(result) ? result : [];
  }
}

let _asyncStorage;
async function getAsyncStorage() {
  if (!_asyncStorage) _asyncStorage = (await import("@react-native-async-storage/async-storage")).default;
  return _asyncStorage;
}

async function readPortersCache() {
  try {
    const storage = await getAsyncStorage();
    const raw = await storage.getItem(PORTERS_CACHE_KEY);
    if (!raw) return { rows: [], isFresh: false };
    const parsed = JSON.parse(raw);
    const rows = Array.isArray(parsed?.rows) ? parsed.rows : [];
    const savedAt = Number(parsed?.savedAt) || 0;
    const isFresh = Date.now() - savedAt <= PORTERS_CACHE_TTL_MS;
    return { rows, isFresh };
  } catch {
    return { rows: [], isFresh: false };
  }
}

async function writePortersCache(rows) {
  try {
    const storage = await getAsyncStorage();
    await storage.setItem(
      PORTERS_CACHE_KEY,
      JSON.stringify({ savedAt: Date.now(), rows: Array.isArray(rows) ? rows : [] })
    );
  } catch {
    // cache write is best-effort
  }
}

function mergePortersPreferCachedImages(cachedRows, nextRows) {
  const cachedById = new Map(
    (Array.isArray(cachedRows) ? cachedRows : [])
      .filter((p) => p && p.id != null)
      .map((p) => [String(p.id), p])
  );
  return (Array.isArray(nextRows) ? nextRows : []).map((p) => {
    const prev = cachedById.get(String(p?.id));
    if (p?.imageBase64 || !prev?.imageBase64) return p;
    return { ...p, imageBase64: prev.imageBase64 };
  });
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
    imageBase64:
      row.image_512 != null && row.image_512 !== false
        ? String(row.image_512)
        : row.image_1920 != null && row.image_1920 !== false
          ? String(row.image_1920)
          : null,
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

/** Faster porter list without image blobs (used for quick initial load). */
export const getPortersEmployeesFast = () =>
  employeeSearchRead([["department_id.name", "=", "Porters"]], {
    limit: 500,
    fields: EMPLOYEE_READ_FIELDS_LIGHT,
  }).then((rows) =>
    rows.map((r) => normalizeEmployee(r)).filter(Boolean)
  );

/**
 * Offline-first porter fetch:
 * - returns cached list immediately when available
 * - refreshes from server when cache is stale or missing
 */
export const getPortersEmployeesOfflineFirst = async () => {
  const cached = await readPortersCache();
  if (cached.rows.length > 0) {
    return cached.rows;
  }
  try {
    const fast = await getPortersEmployeesFast();
    if (fast.length > 0) {
      const merged = mergePortersPreferCachedImages(cached.rows, fast);
      await writePortersCache(merged);
      return merged;
    }
    return cached.rows;
  } catch (e) {
    if (cached.rows.length > 0) return cached.rows;
    throw e;
  }
};

/** Optional background refresh; does not throw. */
export const refreshPortersEmployeesCache = async () => {
  try {
    const fresh = await getPortersEmployees();
    if (fresh.length > 0) {
      const cached = await readPortersCache();
      const merged = mergePortersPreferCachedImages(cached.rows, fresh);
      await writePortersCache(merged);
      return merged;
    }
    return [];
  } catch {
    return [];
  }
};

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
