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
      const vehicleId = numOrNull(r.vehicle_id);
      const productId = numOrNull(product.id);

      // Check if this row was locally modified - if so, skip it to preserve local changes
      const existing = await tx.getFirstAsync(
        `SELECT is_locally_modified FROM vehicle_inventories WHERE vehicle_id = ? AND product_id = ?`,
        [vehicleId, productId]
      );

      if (existing?.is_locally_modified === 1) {
        console.log(`[DB Sync] Skipping sync for locally modified inventory: vehicle ${vehicleId}, product ${productId}`);
        continue;
      }

      await tx.runAsync(
        `INSERT OR REPLACE INTO vehicle_inventories (id, location_id, vehicle_id, product_id, product_name, quantity, available_quantity, updated_at, is_locally_modified) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        [
          r.id != null ? r.id : 0,
          numOrNull(r.location_id),
          vehicleId,
          productId,
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
  const total = await db.getFirstAsync('SELECT COUNT(*) as count FROM vehicle_inventories');
  console.log(`[DB Debug] Total rows in inventory table: ${total.count}`);
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

export async function getVehicleInventoryByLocationId(locationId) {
  if (locationId == null) return [];
  const db = await getDb();
  const total = await db.getFirstAsync('SELECT COUNT(*) as count FROM vehicle_inventories');
  console.log(`[DB Debug] Total rows in inventory table: ${total.count}`);
  const rows = await db.getAllAsync(
    'SELECT id, location_id, vehicle_id, product_id, product_name, quantity, available_quantity FROM vehicle_inventories WHERE location_id = ? ORDER BY product_name',
    [locationId]
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

export async function updateVehicleInventoryQuantity(vehicleId, productId, newQuantity) {
  const db = await getDb();
  console.log(`[DB Update] Setting vehicle ${vehicleId}, product ${productId} to quantity ${newQuantity} (marking as locally modified)`);
  await db.runAsync(
    `UPDATE vehicle_inventories 
     SET available_quantity = ?, 
         updated_at = datetime('now'),
         is_locally_modified = 1
     WHERE vehicle_id = ? AND product_id = ?`,
    [newQuantity, vehicleId, productId]
  );
}

export async function updateVehicleInventoryQuantityByLocation(locationId, productId, newQuantity) {
  const db = await getDb();
  console.log(`[DB Update] Setting location ${locationId}, product ${productId} to quantity ${newQuantity} (marking as locally modified)`);
  await db.runAsync(
    `UPDATE vehicle_inventories 
     SET available_quantity = ?, 
         updated_at = datetime('now'),
         is_locally_modified = 1
     WHERE location_id = ? AND product_id = ?`,
    [newQuantity, locationId, productId]
  );
}

/**
 * Clear the locally modified flag for a specific inventory item.
 * Call this after successfully pushing the inventory update to Odoo.
 */
export async function clearLocalModificationFlag(vehicleId, productId) {
  const db = await getDb();
  await db.runAsync(
    `UPDATE vehicle_inventories SET is_locally_modified = 0 WHERE vehicle_id = ? AND product_id = ?`,
    [vehicleId, productId]
  );
}

/**
 * Clear the locally modified flag for a specific inventory item by location.
 * Call this after successfully pushing the inventory update to Odoo.
 */
export async function clearLocalModificationFlagByLocation(locationId, productId) {
  const db = await getDb();
  await db.runAsync(
    `UPDATE vehicle_inventories SET is_locally_modified = 0 WHERE location_id = ? AND product_id = ?`,
    [locationId, productId]
  );
}

/**
 * Clear all locally modified flags for a vehicle.
 * Call this after a successful full sync with Odoo.
 */
export async function clearAllLocalModificationFlags(vehicleId) {
  const db = await getDb();
  if (vehicleId != null) {
    await db.runAsync(
      `UPDATE vehicle_inventories SET is_locally_modified = 0 WHERE vehicle_id = ?`,
      [vehicleId]
    );
  } else {
    await db.runAsync(`UPDATE vehicle_inventories SET is_locally_modified = 0`);
  }
}

