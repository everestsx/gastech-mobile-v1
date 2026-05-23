/**
 * Apply held inventory queue rows to local SQLite immediately (dashboard / stock summary).
 * Odoo sync still runs later from the queue — this only updates on-device quants.
 */
import * as vehicleInventoriesDb from '../database/vehicleInventories.js';
import * as productsDb from '../database/products.js';
import { resolveLocalInventoryTargetQty } from './inventoryDeduction.js';

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

    if (!options.incrementsOnly && (Number.isFinite(absoluteTarget) || Number(raw?.quantityUsed) > 0)) {
      const existingRows = await vehicleInventoriesDb.getVehicleInventoryByLocationId(loc).catch(() => []);
      const existingRow = (existingRows || []).find((r) => Number(r?.product_id) === productId);
      const currentQty = Number(existingRow?.quantity) || 0;
      const { targetQty } = await resolveLocalInventoryTargetQty(loc, raw, currentQty);
      if (Math.abs(currentQty - targetQty) > 0.02) {
        await vehicleInventoriesDb.updateVehicleInventoryQuantityByLocation(loc, productId, targetQty);
      }
      out.push({ ...raw, newQuantity: targetQty, appliedLocally: true });
      continue;
    }

    out.push(raw);
  }
  return out;
}

/**
 * Single local gas deduction before queue sync wakes — prevents sync from reducing stock again on Odoo/SQLite.
 * @returns {Promise<boolean>} true when local gas rows were applied or already applied
 */
export async function applyLocalGasInventoryForSaleOrder(saleOrderId) {
  const soId = Number(saleOrderId);
  if (!Number.isFinite(soId) || soId <= 0) return false;

  const syncQueueDb = await import('../database/syncQueue.js');
  const inventoryRow = await syncQueueDb.getPendingInventoryUpdateItemBySaleOrderId(soId);
  if (!inventoryRow?.id) return false;

  let payload = { ...(inventoryRow.payload || {}) };
  if (payload._localGasInventoryApplied === true || payload._stockAlreadyReduced === true) {
    return true;
  }

  const locationId = Number(payload.locationId);
  const vehicleId = Number(payload.vehicleId);
  const updates = Array.isArray(payload.updates) ? [...payload.updates] : [];
  if (!Number.isFinite(locationId) || locationId <= 0 || updates.length === 0) return false;

  const gasUpdates = updates.filter(
    (u) =>
      (Number(u?.incrementQuantity) || 0) <= 0 &&
      (Number.isFinite(Number(u?.newQuantity)) || Number(u?.quantityUsed) > 0) &&
      u?.appliedLocally !== true
  );
  if (gasUpdates.length > 0) {
    await applyInventoryUpdatesToLocalDb(locationId, vehicleId, gasUpdates, { incrementsOnly: false });
    for (const u of updates) {
      const pid = Number(u?.productId);
      if (!Number.isFinite(pid)) continue;
      const gas = gasUpdates.find((g) => Number(g?.productId) === pid);
      if (gas) {
        u.appliedLocally = true;
        u.stockAlreadyReduced = true;
        u.odooDeductionApplied = true;
      }
    }
  }

  payload._localGasInventoryApplied = true;
  payload._stockAlreadyReduced = true;
  payload.updates = updates;
  await syncQueueDb.updateQueueItemPayload(inventoryRow.id, payload);
  return true;
}
