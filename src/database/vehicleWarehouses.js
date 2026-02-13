/**
 * Local CRUD for vehicle stock locations (Odoo stock.location per vehicle).
 */
import { getDb } from './db.js';
import { empty, numOrNull, iso } from './dbHelpers.js';

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
