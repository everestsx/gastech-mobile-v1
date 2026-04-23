import { callOdoo, callOdooArgs, callOdooArgsKwargs } from './index.service';

/**
 * Set absolute on-hand quantity for a product at a stock location.
 * Updates existing stock.quant; if none exists (common for newly collected empties on a lorry), creates the quant.
 * @param {number} locationId
 * @param {number} productId
 * @param {number} targetQty
 * @returns {Promise<{ ok: boolean, quantId?: number, created?: boolean }>}
 */
/**
 * Read current Odoo stock.quant quantity at a location (0 if no quant).
 */
export async function readQuantQuantityAtLocation(locationId, productId) {
  if (locationId == null || productId == null) return 0;
  const quantRows = await callOdoo(
    'stock.quant',
    'search_read',
    [
      [
        ['location_id', '=', locationId],
        ['product_id', '=', productId],
      ],
    ],
    { fields: ['id', 'quantity'], limit: 1 }
  );
  const row = Array.isArray(quantRows) ? quantRows[0] : null;
  return Math.max(0, Number(row?.quantity) || 0);
}

/**
 * Apply a signed delta to on-hand at location (reads Odoo first — avoids stale absolute from another device).
 */
export async function adjustQuantQuantityAtLocation(locationId, productId, deltaQty) {
  const delta = Number(deltaQty) || 0;
  if (delta === 0) return { ok: true, targetQty: null };
  const cur = await readQuantQuantityAtLocation(locationId, productId);
  const target = Math.max(0, cur + delta);
  return { ...(await setQuantQuantityAtLocation(locationId, productId, target)), targetQty: target };
}

export async function setQuantQuantityAtLocation(locationId, productId, targetQty) {
  if (locationId == null || productId == null) return { ok: false };
  const target = Math.max(0, Number(targetQty) || 0);

  const quantRows = await callOdoo(
    'stock.quant',
    'search_read',
    [
      [
        ['location_id', '=', locationId],
        ['product_id', '=', productId],
      ],
    ],
    { fields: ['id', 'quantity'], limit: 1 }
  );
  const quantId =
    Array.isArray(quantRows) && quantRows[0]?.id != null ? Number(quantRows[0].id) : null;

  const writeExisting = async (id) => {
    try {
      await callOdoo('stock.quant', 'write', [[id], { quantity: target }]);
    } catch (writeErr) {
      await callOdoo('stock.quant', 'write', [[id], { inventory_quantity: target }]);
      await callOdoo('stock.quant', 'action_apply_inventory', [[id]]);
    }
  };

  if (quantId != null) {
    await writeExisting(quantId);
    return { ok: true, quantId, created: false };
  }

  if (target <= 0) {
    return { ok: true, created: false };
  }

  /** Odoo variants: plain create, inventory fields, or inventory_mode context (common for new quants). */
  const tryCreate = async (vals, kwargs = {}) => {
    const hasKwargs = kwargs && typeof kwargs === 'object' && Object.keys(kwargs).length > 0;
    const newId = hasKwargs
      ? await callOdooArgsKwargs('stock.quant', 'create', [vals], kwargs)
      : await callOdooArgs('stock.quant', 'create', [vals]);
    const nid = newId != null ? Number(newId) : NaN;
    return Number.isFinite(nid) && nid > 0 ? nid : null;
  };

  try {
    let nid = await tryCreate({
      product_id: productId,
      location_id: locationId,
      quantity: target,
    });
    if (nid != null) return { ok: true, quantId: nid, created: true };
  } catch (_) {
    /* try next */
  }

  try {
    let nid = await tryCreate({
      product_id: productId,
      location_id: locationId,
      inventory_quantity: target,
    });
    if (nid != null) {
      await callOdoo('stock.quant', 'action_apply_inventory', [[nid]]);
      return { ok: true, quantId: nid, created: true };
    }
  } catch (_) {
    /* try next */
  }

  try {
    const nid = await tryCreate(
      {
        product_id: productId,
        location_id: locationId,
        inventory_quantity: target,
      },
      { context: { inventory_mode: true } }
    );
    if (nid != null) {
      await callOdoo('stock.quant', 'action_apply_inventory', [[nid]]);
      return { ok: true, quantId: nid, created: true };
    }
  } catch (_) {
    /* try next */
  }

  try {
    const nid = await tryCreate(
      {
        product_id: productId,
        location_id: locationId,
        quantity: target,
      },
      { context: { inventory_mode: true } }
    );
    if (nid != null) return { ok: true, quantId: nid, created: true };
  } catch (e4) {
    throw e4;
  }

  return { ok: false };
}

/**
 * Get lorry/vehicle inventory (stock.quant) for a given stock location.
 * Uses backend stock rows directly (no hardcoded product codes) so renamed products are included.
 * @param {number} locationId - stock.location id (e.g. 94 for 7041/Stock)
 * @returns {Promise<Array>} [{ id, product_id, quantity, available_quantity, incoming_quantity, outgoing_quantity }]
 */
export async function getVehicleInventoryByLocation(locationId) {
  if (locationId == null) return [];
  const response = await callOdoo(
    'stock.quant',
    'search_read',
    [
      [
        ['location_id', '=', locationId],
        ['product_id', '!=', false],
      ],
    ],
    { fields: ['product_id', 'quantity', 'available_quantity', 'incoming_qty', 'outgoing_qty'] }
  );
  const rows = Array.isArray(response) ? response : [];
  const normalized = rows.map((r) => ({
    ...r,
    quantity: Math.max(0, Number(r?.quantity) || 0),
    available_quantity: Math.max(0, Number(r?.available_quantity) || 0),
    incoming_quantity: Math.max(0, Number(r?.incoming_qty) || 0),
    outgoing_quantity: Math.max(0, Number(r?.outgoing_qty) || 0),
  }));
  console.log('[Vehicle Inventory API] locationId:', locationId, 'rows:', normalized.length);
  return normalized;
}
