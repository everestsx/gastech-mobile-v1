import { callOdoo, callOdooArgs } from "./index.service";

/** Get picking(s) for a sale order with move_ids and backorder_ids for delivery flow */
export const getPickingBySaleOrder = (saleOrderId) =>
  callOdoo(
    "stock.picking",
    "search_read",
    [[["sale_id", "=", saleOrderId]]],
    {
      fields: ["id", "name", "state", "move_ids", "backorder_ids"],
      limit: 20,
    }
  );

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

/** Validate delivery order (picking). Returns true or backorder wizard info */
export const validatePicking = (pickingId) =>
  callOdoo("stock.picking", "button_validate", [[pickingId]]);

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
 * Get full delivery data for a sale order: picking, moves, move lines.
 * Use to map order lines (by product_id) to move lines for qty_done updates.
 * Returns { picking, moves, moveLines } or { picking: null, moves: [], moveLines: [] } if no picking.
 */
export const getDeliveryDataForSaleOrder = async (saleOrderId) => {
  const pickings = await getPickingBySaleOrder(saleOrderId);
  const picking = pickings?.[0] ?? null;
  if (!picking?.move_ids?.length) {
    return { picking, moves: [], moveLines: [] };
  }
  const moveIds = picking.move_ids;
  const [moves, moveLines] = await Promise.all([
    getStockMovesByPickingId(picking.id),
    getStockMoveLinesByMoveIds(moveIds),
  ]);
  return { picking, moves: moves ?? [], moveLines: moveLines ?? [] };
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
