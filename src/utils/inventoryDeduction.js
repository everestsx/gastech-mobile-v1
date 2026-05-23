/**
 * Exact delivered-qty stock deduction — idempotent; never double-reduce after delivery validate + local apply.
 */
import { readQuantQuantityAtLocation } from '../services/vehicleInventory.service.js';

const QTY_TOL = 0.02;

export function roundQty3(q) {
  return Math.round(Number(q) * 1000) / 1000;
}

/**
 * Resolve local SQLite target qty: current on lorry minus exact quantityUsed (delivered).
 * Falls back to stored newQuantity when quantityUsed is missing.
 */
export async function resolveLocalInventoryTargetQty(locationId, update = {}, currentQty = null) {
  const loc = Number(locationId);
  const productId = Number(update?.productId);
  const qtyUsed = roundQty3(update?.quantityUsed);
  let current = Number(currentQty);
  if (!Number.isFinite(current) && Number.isFinite(loc) && Number.isFinite(productId)) {
    const rows = await import('../database/vehicleInventories.js').then((m) =>
      m.getVehicleInventoryByLocationId(loc).catch(() => [])
    );
    const row = (rows || []).find((r) => Number(r?.product_id) === productId);
    current = Number(row?.quantity) || 0;
  }
  current = Math.max(0, Number.isFinite(current) ? current : 0);

  if (Number.isFinite(qtyUsed) && qtyUsed > QTY_TOL) {
    return { targetQty: Math.max(0, roundQty3(current - qtyUsed)), mode: 'delta_from_current', currentQty: current };
  }

  const absolute = Number(update?.newQuantity);
  if (Number.isFinite(absolute)) {
    return { targetQty: Math.max(0, roundQty3(absolute)), mode: 'absolute', currentQty: current };
  }
  return { targetQty: current, mode: 'noop', currentQty: current };
}

function storedTargetQty(update) {
  const t = Number(update?.newQuantity);
  return Number.isFinite(t) ? Math.max(0, roundQty3(t)) : null;
}

/**
 * Odoo apply for gas delivery deduction.
 * When delivery validate or local completion already reduced stock, NEVER subtract quantityUsed again.
 */
export async function applyInventoryUpdateOnOdooExact(locationId, productId, update = {}, options = {}) {
  const { applyInventoryQueueUpdateOnOdoo, applyTargetQuantityIdempotent } = await import(
    '../services/vehicleInventory.service.js'
  );

  const tol = options.tolerance ?? QTY_TOL;
  const target = storedTargetQty(update);
  const odooNow = await readQuantQuantityAtLocation(locationId, productId);
  const deliveryDone = options.deliveryStockAlreadyReduced === true;
  const localApplied = options.localInventoryAlreadyApplied === true;
  const alreadyProcessedOnOdoo = update?.odooDeductionApplied === true;

  if (alreadyProcessedOnOdoo) {
    return { ok: true, mode: 'already_processed_flag', odooQty: odooNow, targetQty: target ?? odooNow };
  }

  /** Delivery validate + local apply already moved quants — reconcile to target only, no second delta. */
  if (deliveryDone || localApplied) {
    if (target != null && Math.abs(odooNow - target) <= tol) {
      return { ok: true, mode: 'skip_duplicate_at_target', odooQty: odooNow, targetQty: target };
    }
    if (target != null && odooNow > target + tol) {
      return applyTargetQuantityIdempotent(locationId, productId, target, options);
    }
    if (target != null && odooNow < target - tol) {
      return applyTargetQuantityIdempotent(locationId, productId, target, options);
    }
    return { ok: true, mode: 'skip_duplicate_no_write', odooQty: odooNow, targetQty: target ?? odooNow };
  }

  const inc = Number(update?.incrementQuantity);
  if (Number.isFinite(inc) && inc > 0) {
    return applyInventoryQueueUpdateOnOdoo(locationId, productId, update, options);
  }

  if (target != null) {
    return applyTargetQuantityIdempotent(locationId, productId, target, options);
  }

  return applyInventoryQueueUpdateOnOdoo(locationId, productId, update, options);
}
