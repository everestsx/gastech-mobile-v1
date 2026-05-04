/**
 * Local CRUD for vehicle stock locations (Odoo stock.location per vehicle).
 */
import { getDb } from './db.js';
import { empty, numOrNull, iso } from './dbHelpers.js';
import { deriveWarehouseDigitRunsFromPlate } from '../utils/vehiclePlateStock.js';

export async function upsertVehicleWarehouses(rows) {
  if (!rows?.length) return;
  const db = await getDb();
  const now = iso();
  await db.withTransactionAsync(async (tx) => {
    for (const r of rows) {
      await tx.runAsync(
        `INSERT OR REPLACE INTO vehicle_warehouses (id, vehicle_id, name, complete_name, updated_at) VALUES (?, ?, ?, ?, ?)`,
        [
          r.id != null ? r.id : 0,
          numOrNull(r.vehicle_id),
          empty(r.name),
          empty(r.complete_name),
          now,
        ]
      );
    }
  });
}

export async function getVehicleWarehouseByVehicleId(vehicleId) {
  if (vehicleId == null) return null;
  const db = await getDb();
  const row = await db.getFirstAsync(
    'SELECT id, vehicle_id, name, complete_name FROM vehicle_warehouses WHERE vehicle_id = ?',
    [vehicleId]
  );
  return row || null;
}

export async function getVehicleWarehouseByLocationId(locationId) {
  if (locationId == null) return null;
  const db = await getDb();
  const row = await db.getFirstAsync(
    'SELECT id, vehicle_id, name, complete_name FROM vehicle_warehouses WHERE id = ?',
    [locationId]
  );
  return row || null;
}

export async function getAllVehicleWarehouses() {
  const db = await getDb();
  const rows = await db.getAllAsync(
    'SELECT id, vehicle_id, name, complete_name FROM vehicle_warehouses ORDER BY vehicle_id'
  );
  return rows || [];
}

/**
 * Digit codes to match `vehicle_warehouses.complete_name` (e.g. 0417 in "LN-0417/Stock").
 * Hyphen-aware; avoids `.pop()` using only the last segment ("1", "A", …).
 */
export function warehousePlateDigitsCandidates(plateRaw) {
  const fromPlate = deriveWarehouseDigitRunsFromPlate(plateRaw);
  if (fromPlate.length) return [...new Set(fromPlate)];
  const s = String(plateRaw || '').trim();
  if (!s) return [];
  const out = [];
  const mWord = /\b\d{3,5}\b/g;
  let w;
  while ((w = mWord.exec(s)) !== null) out.push(w[0]);
  const all = s.replace(/\D/g, '');
  if (/^\d{4,}$/.test(all)) {
    const tail = all.slice(-5);
    if (tail !== out[out.length - 1]) out.push(tail);
  }
  return [...new Set(out.filter(Boolean))];
}

/**
 * When vehicle_id ↔ warehouse row is stale, locate location id by plate embedded in complete_name.
 */
export async function findVehicleWarehouseLocationIdByPlateHint(plateRaw) {
  const candidates = warehousePlateDigitsCandidates(plateRaw);
  if (!candidates.length) return null;
  const rows = await getAllVehicleWarehouses();
  const variantsForRun = (digitRun) => {
    const stripped = digitRun.replace(/^0+/, '') || '0';
    if (stripped !== digitRun && stripped.length >= 3) return [digitRun, stripped];
    return [digitRun];
  };

  for (const c of candidates) {
    for (const needle of variantsForRun(c)) {
      const lowered = needle.toLowerCase();
      for (const r of rows || []) {
        const blob = `${String(r.complete_name ?? '')} ${String(r.name ?? '')}`.toLowerCase();
        if (blob.includes(lowered)) {
          const idNum = Number(r.id);
          if (Number.isFinite(idNum) && idNum > 0) return idNum;
        }
      }
    }
  }
  return null;
}
