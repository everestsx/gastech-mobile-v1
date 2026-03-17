import { callOdoo } from "./index.service";

/**
 * Get all fleet vehicles (fleet.vehicle search_read)
 */
/** Fields for fleet.vehicle including journal ids (stored locally for offline Cash/Cheque). */
const VEHICLE_FIELDS = ["id", "name", "license_plate", "model_id", "cash_journal_id", "check_journal_id"];

export const getVehicles = () =>
  callOdoo(
    "fleet.vehicle",
    "search_read",
    [[]],
    {
      fields: VEHICLE_FIELDS,
      order: "name asc",
    }
  );

/**
 * Get a single vehicle by id (for vehicle-scoped sync; avoids fetching all vehicles).
 */
export const getVehicleById = (vehicleId) =>
  callOdoo(
    "fleet.vehicle",
    "search_read",
    [[["id", "=", vehicleId]]],
    {
      fields: VEHICLE_FIELDS,
      limit: 1,
    }
  ).then((rows) => (Array.isArray(rows) && rows.length > 0 ? rows[0] : null));

/** Fields to fetch for vehicle journals (same as API: fleet.vehicle by license_plate). */
const VEHICLE_JOURNAL_FIELDS = ["id", "license_plate", "vehicle_password", "cash_journal_id", "check_journal_id", "sales_team_id"];

/**
 * Fetch vehicle from Odoo by license_plate (logged-in vehicle number) and store locally.
 * Call this at login so cash_journal_id and check_journal_id are available offline.
 * @param {string} licensePlate - Logged-in vehicle number (e.g. "LN-0423")
 * @returns {Promise<{ cashJournalId: number | null, chequeJournalId: number | null }>}
 */
export async function fetchAndStoreVehicleJournals(licensePlate) {
  const trimmed = licensePlate != null ? String(licensePlate).trim() : '';
  if (!trimmed) return { cashJournalId: null, chequeJournalId: null };
  try {
    const rows = await callOdoo(
      "fleet.vehicle",
      "search_read",
      [[["license_plate", "=", trimmed]]],
      { fields: VEHICLE_JOURNAL_FIELDS, limit: 1 }
    );
    const v = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    if (!v) return { cashJournalId: null, chequeJournalId: null };
    const cashId = v.cash_journal_id != null ? (Array.isArray(v.cash_journal_id) ? Number(v.cash_journal_id[0]) : Number(v.cash_journal_id)) : null;
    const chequeId = v.check_journal_id != null ? (Array.isArray(v.check_journal_id) ? Number(v.check_journal_id[0]) : Number(v.check_journal_id)) : null;
    const vehiclesDb = await import('../database/vehicles.js');
    await vehiclesDb.upsertVehicles([{
      id: v.id,
      name: (v.license_plate || String(v.id)).trim(),
      license_plate: trimmed,
      cash_journal_id: v.cash_journal_id,
      check_journal_id: v.check_journal_id,
    }]);
    return { cashJournalId: cashId, chequeJournalId: chequeId };
  } catch (e) {
    console.warn('fetchAndStoreVehicleJournals', e?.message ?? e);
    return { cashJournalId: null, chequeJournalId: null };
  }
}

/**
 * Get vehicle's cash and cheque journal ids for vehicle-specific payment.
 * Uses locally stored journal ids first (stored at login/sync) so Cash/Cheque work offline.
 * When online and local has no ids, fetches from Odoo and upserts so they are stored for next time.
 * @param {string} licensePlate - Vehicle number used during login (e.g. "LN-0423")
 * @param {number | null} [vehicleId] - Optional vehicle id for fallback lookup when license_plate finds no row
 * @returns {Promise<{ cashJournalId: number | null, chequeJournalId: number | null }>}
 */
export const getVehicleJournalsByLicensePlate = async (licensePlate, vehicleId = null) => {
  if (!licensePlate || String(licensePlate).trim() === '') return { cashJournalId: null, chequeJournalId: null };
  const trimmed = String(licensePlate).trim();
  let local = { cashJournalId: null, chequeJournalId: null };
  try {
    const vehiclesDb = await import('../database/vehicles.js');
    local = await vehiclesDb.getVehicleJournalsByLicensePlate(trimmed);
    if (local.cashJournalId != null || local.chequeJournalId != null) return local;
    if (vehicleId != null) {
      local = await vehiclesDb.getVehicleJournalsByVehicleId(vehicleId);
      if (local.cashJournalId != null || local.chequeJournalId != null) return local;
    }
  } catch (e) {
    console.warn('getVehicleJournalsByLicensePlate local read', e?.message ?? e);
  }
  try {
    const rows = await callOdoo(
      "fleet.vehicle",
      "search_read",
      [[["license_plate", "=", trimmed]]],
      { fields: VEHICLE_JOURNAL_FIELDS, limit: 1 }
    );
    const v = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    if (!v) return local;
    const cashId = v.cash_journal_id != null ? (Array.isArray(v.cash_journal_id) ? Number(v.cash_journal_id[0]) : Number(v.cash_journal_id)) : null;
    const chequeId = v.check_journal_id != null ? (Array.isArray(v.check_journal_id) ? Number(v.check_journal_id[0]) : Number(v.check_journal_id)) : null;
    const vehiclesDb = await import('../database/vehicles.js');
    await vehiclesDb.upsertVehicles([{
      id: v.id,
      name: (v.license_plate || String(v.id)).trim(),
      license_plate: trimmed,
      cash_journal_id: v.cash_journal_id,
      check_journal_id: v.check_journal_id,
    }]);
    return { cashJournalId: cashId, chequeJournalId: chequeId };
  } catch (e) {
    return local;
  }
};

/** True if the error is due to network unreachability (no response from server). */
function isNetworkError(error) {
  const msg = (error?.message || String(error)).toLowerCase();
  return (
    msg.includes('network request failed') ||
    msg.includes('failed to fetch') ||
    msg.includes('network error') ||
    (error?.name === 'TypeError' && msg.includes('network'))
  );
}

/**
 * Validates credentials directly against the Odoo fleet.vehicle model.
 * Throws a user-friendly message for network vs auth failures.
 */
export const authenticateVehicleOnline = async (vehicleId, enteredPassword) => {
  try {
    const technicalName = 'vehicle_password';

    const count = await callOdoo("fleet.vehicle", "search_count", [
      [
        ["id", "=", vehicleId],
        [technicalName, "=", enteredPassword]
      ]
    ]);

    return count === 1;
  } catch (error) {
    if (isNetworkError(error)) {
      console.warn("Odoo Auth: server unreachable — check device internet.");
      throw new Error(
        "Cannot reach server. Please check your internet connection (WiFi or mobile data) and try again."
      );
    }
    console.warn("Odoo Auth Error:", error?.message || error);
    throw new Error(
      error?.message?.includes("Odoo") ? error.message : "Invalid vehicle or password. Please try again."
    );
  }
};