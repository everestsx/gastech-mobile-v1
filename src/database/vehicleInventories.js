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

      // Check if this row was locally modified.
      // Keep local quantity/available_quantity, but still refresh product_name from backend
      // so renamed products (e.g. GAS2.3 -> GAS2.4) appear correctly in UI.
      const existing = await tx.getFirstAsync(
        `SELECT is_locally_modified FROM vehicle_inventories WHERE vehicle_id = ? AND product_id = ?`,
        [vehicleId, productId]
      );

      if (existing?.is_locally_modified === 1) {
        await tx.runAsync(
          `UPDATE vehicle_inventories SET product_name = ?, updated_at = ? WHERE vehicle_id = ? AND product_id = ?`,
          [empty(product.name), now, vehicleId, productId]
        );
        console.log(`[DB Sync] Preserved local qty but refreshed name for locally modified inventory: vehicle ${vehicleId}, product ${productId}`);
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

function computeAvailableAfterQtyChange(oldQty, oldAvail, newQty) {
  const Q0 = Math.max(0, Number(oldQty) || 0);
  const Q1 = Math.max(0, Number(newQty) || 0);
  const A0raw = Number(oldAvail);
  const A0safe = Number.isFinite(A0raw) ? Math.max(0, A0raw) : Q0;
  if (Q1 > Q0 + 0.0001) {
    const add = Q1 - Q0;
    return Math.min(Q1, A0safe + add);
  }
  const d = Math.max(0, Q0 - Q1);
  let newAvail;
  if (A0safe >= Q0 - 0.0001) {
    newAvail = Math.min(Q1, Math.max(0, d));
  } else {
    const reserved0 = Math.max(0, Q0 - A0safe);
    const releasedFromReserve = Math.min(d, reserved0);
    newAvail = Math.max(0, Math.min(Q1, A0safe + releasedFromReserve));
  }
  return newAvail;
}

export async function updateVehicleInventoryQuantity(vehicleId, productId, newQuantity) {
  const db = await getDb();
  const existing = await db.getFirstAsync(
    `SELECT quantity, available_quantity FROM vehicle_inventories WHERE vehicle_id = ? AND product_id = ?`,
    [vehicleId, productId]
  );
  const Q0 = Number(existing?.quantity) || 0;
  const A0 = existing?.available_quantity;
  const Q1 = Math.max(0, Number(newQuantity) || 0);
  const newAvail = computeAvailableAfterQtyChange(Q0, A0, Q1);
  console.log(`[DB Update] Setting vehicle ${vehicleId}, product ${productId} to quantity ${Q1}, available ${newAvail} (marking as locally modified)`);
  await db.runAsync(
    `UPDATE vehicle_inventories 
     SET quantity = ?,
         available_quantity = ?, 
         updated_at = datetime('now'),
         is_locally_modified = 1
     WHERE vehicle_id = ? AND product_id = ?`,
    [Q1, newAvail, vehicleId, productId]
  );
}

export async function updateVehicleInventoryQuantityByLocation(locationId, productId, newQuantity) {
  const db = await getDb();
  const existing = await db.getFirstAsync(
    `SELECT quantity, available_quantity FROM vehicle_inventories WHERE location_id = ? AND product_id = ?`,
    [locationId, productId]
  );
  const Q0 = Number(existing?.quantity) || 0;
  const A0 = existing?.available_quantity;
  const Q1 = Math.max(0, Number(newQuantity) || 0);
  const newAvail = computeAvailableAfterQtyChange(Q0, A0, Q1);
  console.log(`[DB Update] Setting location ${locationId}, product ${productId} to quantity ${Q1}, available ${newAvail} (marking as locally modified)`);
  await db.runAsync(
    `UPDATE vehicle_inventories 
     SET quantity = ?,
         available_quantity = ?, 
         updated_at = datetime('now'),
         is_locally_modified = 1
     WHERE location_id = ? AND product_id = ?`,
    [Q1, newAvail, locationId, productId]
  );
}

/**
 * Like updateVehicleInventoryQuantityByLocation but INSERTs a row when this product has no quant row locally yet
 * (e.g. empty cylinders collected before any empty stock existed on the lorry).
 */
export async function upsertVehicleInventoryQuantityByLocation(
  locationId,
  vehicleId,
  productId,
  productName,
  newQuantity
) {
  const db = await getDb();
  const existing = await db.getFirstAsync(
    `SELECT id FROM vehicle_inventories WHERE location_id = ? AND product_id = ?`,
    [locationId, productId]
  );
  if (existing?.id != null) {
    await updateVehicleInventoryQuantityByLocation(locationId, productId, newQuantity);
    return;
  }
  const syntheticId = -(Math.abs(Number(productId)) + Math.abs(Number(locationId)) * 100000);
  console.log(
    `[DB Insert] New inventory row location ${locationId}, product ${productId} qty ${newQuantity} (synthetic id ${syntheticId})`
  );
  await db.runAsync(
    `INSERT OR REPLACE INTO vehicle_inventories (id, location_id, vehicle_id, product_id, product_name, quantity, available_quantity, updated_at, is_locally_modified)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), 1)`,
    [
      syntheticId,
      locationId,
      vehicleId,
      productId,
      empty(productName),
      newQuantity,
      newQuantity,
    ]
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

/**
 * Keep only backend-returned quant ids for a location (preserve locally modified rows).
 */
export async function pruneInventoryForLocationToIds(locationId, keepQuantIds = []) {
  if (locationId == null) return;
  const db = await getDb();
  const keep = (Array.isArray(keepQuantIds) ? keepQuantIds : [])
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0);

  if (keep.length === 0) {
    await db.runAsync(
      `DELETE FROM vehicle_inventories
       WHERE location_id = ? AND COALESCE(is_locally_modified, 0) = 0`,
      [locationId]
    );
    return;
  }

  const placeholders = keep.map(() => '?').join(',');
  await db.runAsync(
    `DELETE FROM vehicle_inventories
     WHERE location_id = ?
       AND COALESCE(is_locally_modified, 0) = 0
       AND id NOT IN (${placeholders})`,
    [locationId, ...keep]
  );
}

