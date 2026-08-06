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
      const locationId = r.id != null ? Number(r.id) : 0;
      const vehicleId = numOrNull(r.vehicle_id);
      // Keep one mapping per vehicle AND one owner per location id.
      // Prevents vehicle switches from stealing another vehicle's warehouse row
      // (table PK is location id) and leaving the previous vehicle with no location.
      if (vehicleId != null) {
        await tx.runAsync(`DELETE FROM vehicle_warehouses WHERE vehicle_id = ? AND id != ?`, [
          vehicleId,
          locationId,
        ]);
      }
      if (locationId) {
        await tx.runAsync(`DELETE FROM vehicle_warehouses WHERE id = ?`, [locationId]);
      }
      await tx.runAsync(
        `INSERT INTO vehicle_warehouses (id, vehicle_id, name, complete_name, updated_at) VALUES (?, ?, ?, ?, ?)`,
        [locationId, vehicleId, empty(r.name), empty(r.complete_name), now]
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
