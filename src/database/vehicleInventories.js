/**
 * Local CRUD for vehicle inventory (stock.quant per vehicle/location).
 */
import { getDb } from './db.js';
import { empty, num, numOrNull, iso } from './dbHelpers.js';

function odooRel(idName) {
  if (Array.isArray(idName)) return { id: idName[0], name: idName[1] ?? null };
  return { id: idName, name: null };
}

export async function upsertVehicleInventories(rows) {
  if (!rows?.length) return;
  const db = await getDb();
  const now = iso();
  await db.withTransactionAsync(async (tx) => {
    for (const r of rows) {
      const product = odooRel(r.product_id);
      await tx.runAsync(
        `INSERT OR REPLACE INTO vehicle_inventories (id, location_id, vehicle_id, product_id, product_name, quantity, available_quantity, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          r.id != null ? r.id : 0,
          numOrNull(r.location_id),
          numOrNull(r.vehicle_id),
          numOrNull(product.id),
          empty(product.name),
          num(r.quantity),
          num(r.available_quantity),
          now,
        ]
      );
    }
  });
}

export async function getVehicleInventoryByVehicleId(vehicleId) {
  if (vehicleId == null) return [];
  const db = await getDb();
  const rows = await db.getAllAsync(
    'SELECT id, location_id, vehicle_id, product_id, product_name, quantity, available_quantity FROM vehicle_inventories WHERE vehicle_id = ? ORDER BY product_name',
    [vehicleId]
  );
  return (rows || []).map((row) => ({
    id: row.id,
    location_id: row.location_id,
    vehicle_id: row.vehicle_id,
    product_id: row.product_id,
    product_name: row.product_name,
    quantity: row.quantity,
    available_quantity: row.available_quantity,
  }));
}

export async function getAllVehicleInventories() {
  const db = await getDb();
  const rows = await db.getAllAsync(
    'SELECT id, location_id, vehicle_id, product_id, product_name, quantity, available_quantity FROM vehicle_inventories ORDER BY vehicle_id, product_name'
  );
  return (rows || []).map((row) => ({
    id: row.id,
    location_id: row.location_id,
    vehicle_id: row.vehicle_id,
    product_id: row.product_id,
    product_name: row.product_name,
    quantity: row.quantity,
    available_quantity: row.available_quantity,
  }));
}
