/**
 * Apply held inventory queue rows to local SQLite immediately (dashboard / stock summary).
 * Odoo sync still runs later from the queue — this only updates on-device quants.
 */
import * as vehicleInventoriesDb from '../database/vehicleInventories.js';
import * as productsDb from '../database/products.js';

/**
 * @param {number} locationId
 * @param {number} vehicleId
 * @param {Array<{ productId?: number, incrementQuantity?: number, newQuantity?: number, appliedLocally?: boolean }>} updates
 * @param {{ incrementsOnly?: boolean }} [options]
 * @returns {Promise<Array>} updates with appliedLocally set on rows that were written
 */
export async function applyInventoryUpdatesToLocalDb(locationId, vehicleId, updates = [], options = {}) {
  const loc = Number(locationId);
  if (!Number.isFinite(loc) || loc <= 0) return updates || [];

  const out = [];
  for (const raw of updates || []) {
    const productId = Number(raw?.productId);
    if (!Number.isFinite(productId) || productId <= 0) {
      out.push(raw);
      continue;
    }

    const increment = Number(raw?.incrementQuantity);
    const absoluteTarget = Number(raw?.newQuantity);

    if (Number.isFinite(increment) && increment > 0) {
      if (raw.appliedLocally === true) {
        out.push(raw);
        continue;
      }
      const inventoryRows = await vehicleInventoriesDb
        .getVehicleInventoryByLocationId(loc)
        .catch(() => []);
      const existingRow = (inventoryRows || []).find((r) => Number(r?.product_id) === productId);
      const current = Number(existingRow?.quantity) || 0;
      const nextQty = Math.max(0, current + increment);
      const productName =
        (await productsDb.getProductById(productId))?.name || existingRow?.product_name || '';
      const vid = Number(vehicleId);
      if (Number.isFinite(vid) && vid > 0) {
        await vehicleInventoriesDb.upsertVehicleInventoryQuantityByLocation(
          loc,
          vid,
          productId,
          productName,
          nextQty
        );
      } else {
        await vehicleInventoriesDb.updateVehicleInventoryQuantityByLocation(loc, productId, nextQty);
      }
      out.push({ ...raw, appliedLocally: true });
      continue;
    }

    if (!options.incrementsOnly && Number.isFinite(absoluteTarget)) {
      const existingRows = await vehicleInventoriesDb.getVehicleInventoryByLocationId(loc).catch(() => []);
      const existingRow = (existingRows || []).find((r) => Number(r?.product_id) === productId);
      const currentQty = Number(existingRow?.quantity) || 0;
      const targetQty = Math.max(0, absoluteTarget);
      if (Math.abs(currentQty - targetQty) > 0.02) {
        await vehicleInventoriesDb.updateVehicleInventoryQuantityByLocation(loc, productId, targetQty);
      }
      out.push(raw);
      continue;
    }

    out.push(raw);
  }
  return out;
}
