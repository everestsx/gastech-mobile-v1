import { callOdoo, callOdooArgs, callOdooArgsKwargs } from "./index.service";

/** Get picking(s) for a sale order with move_ids and backorder_ids for delivery flow */
/** Outgoing transfers for a sale order, oldest first (parent delivery before backorders). */
export const getPickingBySaleOrder = (saleOrderId) =>
  callOdoo(
    "stock.picking",
    "search_read",
    [[["sale_id", "=", saleOrderId]]],
    {
      fields: ["id", "name", "state", "move_ids", "backorder_ids"],
      limit: 20,
      order: "id asc",
    }
  );

/** Get picking state for multiple sale orders in one call. Returns list of { id, sale_id, state }. */
export const getPickingsBySaleIds = (saleOrderIds) => {
  if (!Array.isArray(saleOrderIds) || saleOrderIds.length === 0) return Promise.resolve([]);
  return callOdoo(
    "stock.picking",
    "search_read",
    [[["sale_id", "in", saleOrderIds]]],
    {
      fields: ["id", "sale_id", "state"],
      limit: 500,
    }
  );
};

/** Get stock moves for a picking (to map products to move lines) */
export const getStockMovesByPickingId = (pickingId) =>
  callOdoo(
    "stock.move",
    "search_read",
    [[["picking_id", "=", pickingId]]],
    {
      fields: ["id", "product_uom_qty", "product_id", "state"],
    }
  );

/** Get stock move lines by move ids (for updating qty_done) */
export const getStockMoveLinesByMoveIds = (moveIds) =>
  callOdoo(
    "stock.move.line",
    "search_read",
    [[["move_id", "in", moveIds]]],
    {
      fields: ["id", "move_id", "qty_done"],
    }
  );

/** Legacy: get move lines by ids (read) */
export const getMoveLines = (ids) =>
  callOdoo("stock.move.line", "read", [ids], {
    fields: ["id", "move_id", "product_id", "product_uom_qty", "qty_done"],
  });

/** Update one stock.move.line qty_done */
export const updateMoveLineQty = (lineId, qty) =>
  callOdoo("stock.move.line", "write", [[lineId], { qty_done: qty }]);

/** Update stock.move demand (product_uom_qty) so delivery can accept higher qty_done */
export const updateStockMoveQty = (moveId, qty) =>
  callOdoo("stock.move", "write", [[moveId], { product_uom_qty: qty }]);

/**
 * Set done qty on stock.move — Odoo propagates to move lines (recommended after qty_done writes or when lines were missing).
 * Field name matches Odoo 16+; if write fails (readonly on some DBs), sync still relies on stock.move.line.
 */
export const updateStockMoveQuantityDone = (moveId, qtyDone) =>
  callOdoo("stock.move", "write", [[moveId], { quantity_done: Number(qtyDone) }]);

/** Validate delivery order (picking). Returns true or backorder wizard info */
export const validatePicking = (pickingId) =>
  callOdooArgs("stock.picking", "button_validate", [[pickingId]]);

/** Validate picking with context (e.g. skip_backorder to avoid backorder wizard). */
export const validatePickingWithContext = (pickingId, context = {}) =>
  callOdooArgsKwargs(
    "stock.picking",
    "button_validate",
    [[pickingId]],
    { context: { ...context } }
  );

/** Create stock.move.line with qty_done (for offline sync: set delivered qty per move). */
export const createMoveLine = (pickingId, moveId, productId, qtyDone) =>
  callOdooArgs("stock.move.line", "create", [
    [{ move_id: moveId, picking_id: pickingId, product_id: productId, qty_done: Number(qtyDone) }],
  ]);

/** Create backorder confirmation wizard. pickIds = [59] -> pick_ids [[4, 59, 0]] */
export const createBackorderConfirmation = (pickIds) =>
  callOdooArgs("stock.backorder.confirmation", "create", [
    {
      pick_ids: pickIds.map((id) => [4, id, 0]),
      show_transfers: false,
    },
  ]);

/** Process backorder confirmation wizard (wizard record id from create) */
export const processBackorderConfirmation = (wizardId) =>
  callOdooArgs("stock.backorder.confirmation", "process", [[wizardId]]);

/** Get picking state by id */
export const getPickingState = (pickingId) =>
  callOdoo(
    "stock.picking",
    "search_read",
    [[["id", "=", pickingId]]],
    { fields: ["id", "state"] }
  );

/**
 * Try to reserve stock for the transfer (Odoo "Check availability").
 * Required when the picking is Waiting / Not Available; otherwise Validate often fails.
 */
export const actionAssignPicking = (pickingId) =>
  callOdooArgs("stock.picking", "action_assign", [[pickingId]]);

/** Confirm transfer before assignment/validation (safe no-op if already confirmed). */
export const actionConfirmPicking = (pickingId) =>
  callOdooArgs("stock.picking", "action_confirm", [[pickingId]]);

/**
 * Get full delivery data for a sale order: picking, moves, move lines.
 * Use to map order lines (by product_id) to move lines for qty_done updates.
 * Returns { picking, moves, moveLines } or { picking: null, moves: [], moveLines: [] } if no picking.
 */
export const getDeliveryDataForSaleOrder = async (saleOrderId) => {
  const pickings = await getPickingBySaleOrder(saleOrderId);
  const picking = pickings?.[0] ?? null;
  if (!picking?.id) {
    return { picking, moves: [], moveLines: [] };
  }
  const moves = await getStockMovesByPickingId(picking.id);
  const moveIdsFromMoves = (moves || []).map((m) => m.id).filter((id) => id != null);
  const moveLines =
    moveIdsFromMoves.length > 0 ? await getStockMoveLinesByMoveIds(moveIdsFromMoves) : [];
  return { picking, moves: moves ?? [], moveLines: moveLines ?? [] };
};

/**
 * Build map: productId (number) -> stock.move id (for updating move demand).
 * moves: [{ id, product_id: [id, name], ... }]
 */
export const buildProductIdToMoveIdMap = (moves) => {
  const productIdToMoveId = {};
  (moves || []).forEach((m) => {
    const productId = Array.isArray(m.product_id) ? m.product_id[0] : m.product_id;
    if (productId != null) productIdToMoveId[productId] = m.id;
  });
  return productIdToMoveId;
};

/**
 * Build map: productId (number) -> stock.move.line id for updating qty_done.
 * moves: [{ id, product_id: [id, name], ... }], moveLines: [{ id, move_id: [id, name], ... }]
 */
export const buildProductIdToMoveLineIdMap = (moves, moveLines) => {
  const moveIdToProductId = {};
  (moves || []).forEach((m) => {
    const productId = Array.isArray(m.product_id) ? m.product_id[0] : m.product_id;
    if (productId != null) moveIdToProductId[m.id] = productId;
  });
  const productIdToMoveLineId = {};
  (moveLines || []).forEach((ml) => {
    const moveId = Array.isArray(ml.move_id) ? ml.move_id[0] : ml.move_id;
    const productId = moveIdToProductId[moveId];
    if (productId != null) productIdToMoveLineId[productId] = ml.id;
  });
  return productIdToMoveLineId;
};
