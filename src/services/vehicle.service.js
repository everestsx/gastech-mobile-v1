import { callOdoo, callOdooJson2 } from "./index.service";

/**
 * Get all fleet vehicles (fleet.vehicle search_read)
 */
/** Fields for fleet.vehicle (aligned with Odoo ACLs; avoid model_id if user lacks fleet.model access). */
const VEHICLE_FIELDS = [
  "id",
  "name",
  "license_plate",
  "cash_journal_id",
  "check_journal_id",
  "sales_team_id",
];
const VEHICLE_ID_FIELDS = ["id", "name", "license_plate"];
const VEHICLE_FETCH_LIMIT = 500;

function parsePositiveId(raw) {
  if (raw == null || raw === false) return null;
  if (Array.isArray(raw)) return parsePositiveId(raw[0]);
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function normalizePlate(raw) {
  return String(raw ?? "").trim();
}

function plateKey(raw) {
  return normalizePlate(raw).toLowerCase().replace(/[\s\-_.]/g, "");
}

function platesEquivalent(a, b) {
  const ka = plateKey(a);
  const kb = plateKey(b);
  return Boolean(ka && kb && ka === kb);
}

async function vehicleSearchRead(domain, { fields = VEHICLE_FIELDS, limit = 20, order } = {}) {
  const opts = { fields, limit };
  if (order) opts.order = order;
  try {
    const rows = await callOdoo("fleet.vehicle", "search_read", [domain], opts);
    if (Array.isArray(rows) && rows.length > 0) return rows;
  } catch (e) {
    console.warn("fleet.vehicle search_read jsonrpc", e?.message ?? e);
  }
  try {
    const rows = await callOdooJson2("fleet.vehicle", "search_read", {
      domain,
      fields,
      limit,
      ...(order ? { order } : {}),
    });
    return Array.isArray(rows) ? rows : [];
  } catch (e) {
    console.warn("fleet.vehicle search_read json2", e?.message ?? e);
    return [];
  }
}

function pickBestVehicleRow(rows, hintedId, plate) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  if (hintedId != null) {
    const hinted = rows.find((r) => parsePositiveId(r?.id) === hintedId);
    if (hinted) return hinted;
  }
  if (plate) {
    const exact = rows.find(
      (r) => platesEquivalent(r?.license_plate, plate) || platesEquivalent(r?.name, plate)
    );
    if (exact) return exact;
  }
  return rows[0];
}

/**
 * Bind the live Odoo fleet.vehicle id for odometer writes.
 * Local SQLite ids can be stale or duplicated by plate; Postman works because it uses the real id.
 */
export async function resolveFleetVehicleId({ vehicleId, licensePlate } = {}) {
  const hintedId = parsePositiveId(vehicleId);
  const plate = normalizePlate(licensePlate);

  if (hintedId != null) {
    const byId = await vehicleSearchRead([["id", "=", hintedId]], {
      fields: VEHICLE_ID_FIELDS,
      limit: 1,
    });
    const rec = byId[0];
    if (rec) {
      const recPlate = rec.license_plate || rec.name;
      if (!plate || platesEquivalent(plate, recPlate) || platesEquivalent(plate, rec.license_plate) || platesEquivalent(plate, rec.name)) {
        return hintedId;
      }
    }
  }

  if (plate) {
    let rows = await vehicleSearchRead([["license_plate", "=", plate]], {
      fields: VEHICLE_ID_FIELDS,
      limit: 20,
    });
    if (!rows.length) {
      rows = await vehicleSearchRead([["license_plate", "ilike", plate]], {
        fields: VEHICLE_ID_FIELDS,
        limit: 20,
      });
    }
    if (!rows.length) {
      rows = await vehicleSearchRead([["name", "ilike", plate]], {
        fields: VEHICLE_ID_FIELDS,
        limit: 20,
      });
    }
    const match = pickBestVehicleRow(rows, hintedId, plate);
    const resolved = parsePositiveId(match?.id);
    if (resolved != null) return resolved;
  }

  return hintedId;
}

export const getVehicles = async () => {
  const rows = await vehicleSearchRead([], {
    fields: VEHICLE_FIELDS,
    limit: VEHICLE_FETCH_LIMIT,
    order: "name asc",
  });
  return Array.isArray(rows) ? rows : [];
};

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
    const rows = await vehicleSearchRead([["license_plate", "=", trimmed]], {
      fields: VEHICLE_JOURNAL_FIELDS,
      limit: 1,
    });
    let v = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    if (!v) {
      const fuzzy = await vehicleSearchRead([["license_plate", "ilike", trimmed]], {
        fields: VEHICLE_JOURNAL_FIELDS,
        limit: 5,
      });
      v = pickBestVehicleRow(fuzzy, null, trimmed);
    }
    if (!v) return { cashJournalId: null, chequeJournalId: null };
    const cashId = parsePositiveId(v.cash_journal_id);
    const chequeId = parsePositiveId(v.check_journal_id);
    const vehiclesDb = await import('../database/vehicles.js');
    await vehiclesDb.upsertVehicles([{
      id: v.id,
      name: (v.license_plate || String(v.id)).trim(),
      license_plate: trimmed,
      cash_journal_id: cashId,
      check_journal_id: chequeId,
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
  const trimmed = licensePlate != null ? String(licensePlate).trim() : '';
  const vid = parsePositiveId(vehicleId);
  if (!trimmed && vid == null) return { cashJournalId: null, chequeJournalId: null };
  let local = { cashJournalId: null, chequeJournalId: null };
  try {
    const vehiclesDb = await import('../database/vehicles.js');
    if (trimmed) {
      local = await vehiclesDb.getVehicleJournalsByLicensePlate(trimmed);
    }
    local = {
      cashJournalId: parsePositiveId(local.cashJournalId),
      chequeJournalId: parsePositiveId(local.chequeJournalId),
    };
    if (vid != null && (local.cashJournalId == null || local.chequeJournalId == null)) {
      const byId = await vehiclesDb.getVehicleJournalsByVehicleId(vid);
      local = {
        cashJournalId: local.cashJournalId ?? parsePositiveId(byId.cashJournalId),
        chequeJournalId: local.chequeJournalId ?? parsePositiveId(byId.chequeJournalId),
      };
    }
    if (local.cashJournalId != null && local.chequeJournalId != null) return local;
  } catch (e) {
    console.warn('getVehicleJournalsByLicensePlate local read', e?.message ?? e);
  }
  try {
    let v = null;
    if (vid != null) {
      v = await getVehicleById(vid).catch(() => null);
    }
    if (!v && trimmed) {
      let rows = await vehicleSearchRead([["license_plate", "=", trimmed]], {
        fields: VEHICLE_JOURNAL_FIELDS,
        limit: 1,
      });
      v = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
      if (!v) {
        rows = await vehicleSearchRead([["license_plate", "ilike", trimmed]], {
          fields: VEHICLE_JOURNAL_FIELDS,
          limit: 5,
        });
        v = pickBestVehicleRow(rows, vid, trimmed);
      }
    }
    if (v) {
      const cashId = parsePositiveId(v.cash_journal_id) ?? local.cashJournalId;
      const chequeId = parsePositiveId(v.check_journal_id) ?? local.chequeJournalId;
      const vehiclesDb = await import('../database/vehicles.js');
      await vehiclesDb.upsertVehicles([{
        id: v.id,
        name: (v.license_plate || v.name || String(v.id)).trim(),
        license_plate: trimmed || v.license_plate,
        cash_journal_id: cashId,
        check_journal_id: chequeId,
      }]);
      local = { cashJournalId: cashId, chequeJournalId: chequeId };
    }
  } catch (e) {
    console.warn('getVehicleJournalsByLicensePlate odoo', e?.message ?? e);
  }
  if (local.cashJournalId != null && local.chequeJournalId != null) return local;
  try {
    const { getCashTypeJournalIds } = await import('./journal.service.js');
    const fallback = await getCashTypeJournalIds();
    const cashId = local.cashJournalId ?? parsePositiveId(fallback.cashJournalId);
    const chequeId = local.chequeJournalId ?? parsePositiveId(fallback.chequeJournalId);
    if (cashId != null || chequeId != null) {
      local = { cashJournalId: cashId, chequeJournalId: chequeId };
      if (vid != null || trimmed) {
        const vehiclesDb = await import('../database/vehicles.js');
        await vehiclesDb.updateVehicleJournals(trimmed || '', cashId, chequeId);
        if (vid != null) {
          await vehiclesDb.upsertVehicles([{
            id: vid,
            name: trimmed || String(vid),
            license_plate: trimmed,
            cash_journal_id: cashId,
            check_journal_id: chequeId,
          }]);
        }
      }
    }
  } catch (_) {
    /* offline — keep whatever local ids we have */
  }
  return local;
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