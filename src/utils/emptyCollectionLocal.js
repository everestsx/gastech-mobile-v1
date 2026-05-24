import * as vehicleInventoriesDb from '../database/vehicleInventories.js';

/** Split held inventory queue rows: gas/absolute deductions vs empty-cylinder increments. */
export function splitInventoryQueueUpdates(updates = []) {
  const gasOrAbsolute = [];
  const emptyIncrements = [];
  for (const u of updates || []) {
    if (Number(u?.incrementQuantity) > 0) emptyIncrements.push(u);
    else gasOrAbsolute.push(u);
  }
  return { gasOrAbsolute, emptyIncrements };
}

/**
 * Undo locally applied empty increments before re-collecting on the same order.
 * Prevents stacking previous + latest empty qty on the lorry.
 */
export async function revertAppliedEmptyIncrements(locationId, emptyIncrements = []) {
  const loc = Number(locationId);
  if (!Number.isFinite(loc) || loc <= 0) return;
  for (const u of emptyIncrements || []) {
    if (u?.appliedLocally !== true) continue;
    const inc = Number(u?.incrementQuantity);
    const pid = Number(u?.productId);
    if (!(inc > 0) || !Number.isFinite(pid)) continue;
    const rows = await vehicleInventoriesDb.getVehicleInventoryByLocationId(loc).catch(() => []);
    const row = (rows || []).find((r) => Number(r?.product_id) === pid);
    const current = Number(row?.quantity) || 0;
    const next = Math.max(0, current - inc);
    await vehicleInventoriesDb.updateVehicleInventoryQuantityByLocation(loc, pid, next);
  }
}

/** Keep gas deduction rows; replace empty increment rows with the latest collection. */
export function mergeInventoryQueueKeepingGas(existingUpdates, newEmptyUpdates) {
  const { gasOrAbsolute } = splitInventoryQueueUpdates(existingUpdates);
  return [...gasOrAbsolute, ...(newEmptyUpdates || [])];
}
