import { callOdoo, callOdooArgs, callOdooArgsKwargs } from "./index.service";
import { coerceDeliveredQty } from "../utils/deliverySync.js";

function dedupeMoveLineUpdatesByLineId(updates = []) {
  const byLine = new Map();
  for (const u of updates || []) {
    const lid = Number(u?.moveLineId);
    if (!Number.isFinite(lid) || lid <= 0) continue;
    byLine.set(lid, u);
  }
  return [...byLine.values()];
}

/** Prefer the line that already has qty_done — lowest-id empty lines must not steal/zero the real qty. */
function pickKeeperMoveLine(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return null;
  let keeper = list[0];
  let best = coerceDeliveredQty(keeper?.qty_done);
  if (!Number.isFinite(best)) best = -1;
  for (let i = 1; i < list.length; i++) {
    const q = coerceDeliveredQty(list[i]?.qty_done);
    const qn = Number.isFinite(q) ? q : -1;
    if (qn > best) {
      keeper = list[i];
      best = qn;
    } else if (qn === best && Number(list[i]?.id) < Number(keeper?.id)) {
      keeper = list[i];
    }
  }
  return keeper;
}

/**
 * Map deliveryLines to existing stock.move.line writes (exact qty) instead of creating duplicate lines on retry.
 */
export async function enrichDeliverySnapshotWithExistingMoveLines(pickingId, snapshot = {}) {
  const pid = Number(pickingId);
  if (!Number.isFinite(pid) || pid <= 0) return snapshot;

  const deliveryLines = Array.isArray(snapshot.deliveryLines) ? snapshot.deliveryLines : [];
  const moveLineUpdates = [...(snapshot.moveLineUpdates || [])];
  const moveIds = [
    ...new Set(
      deliveryLines
        .map((line) => Number(line?.moveId ?? line?.move_id))
        .filter((mid) => Number.isFinite(mid) && mid > 0)
    ),
  ];
  if (!moveIds.length) {
    return {
      ...snapshot,
      moveLineUpdates: dedupeMoveLineUpdatesByLineId(moveLineUpdates),
    };
  }

  const existingRows = await getStockMoveLinesByMoveIds(moveIds).catch(() => []);
  const byMove = new Map();
  for (const ml of existingRows || []) {
    const mid = Number(Array.isArray(ml?.move_id) ? ml.move_id[0] : ml?.move_id);
    if (!Number.isFinite(mid) || mid <= 0) continue;
    const list = byMove.get(mid) || [];
    list.push(ml);
    byMove.set(mid, list);
  }

  const remainingDeliveryLines = [];
  for (const line of deliveryLines) {
    const mid = Number(line?.moveId ?? line?.move_id);
    const target = coerceDeliveredQty(line?.qty_done);
    if (!Number.isFinite(mid) || mid <= 0 || !Number.isFinite(target)) {
      remainingDeliveryLines.push(line);
      continue;
    }
    const rows = (byMove.get(mid) || []).sort((a, b) => Number(a?.id) - Number(b?.id));
    if (!rows.length) {
      remainingDeliveryLines.push(line);
      continue;
    }
    const keeper = pickKeeperMoveLine(rows) || rows[0];
    moveLineUpdates.push({
      moveLineId: keeper.id,
      moveId: mid,
      productId: line.productId ?? line.product_id,
      qty_done: target,
    });
    // Only zero extra lines that currently hold qty (duplicate create). Never write 0 onto
    // the keeper, and never emit no-op zeros — those overwrote Done qty 12→0 on retry.
    if (Number.isFinite(target) && target > 0.0001) {
      for (const row of rows) {
        if (Number(row?.id) === Number(keeper.id)) continue;
        const extraQty = coerceDeliveredQty(row?.qty_done);
        if (!Number.isFinite(extraQty) || extraQty <= 0.0001) continue;
        moveLineUpdates.push({
          moveLineId: row.id,
          moveId: mid,
          productId: line.productId ?? line.product_id,
          qty_done: 0,
        });
      }
    }
  }

  return {
    ...snapshot,
    deliveryLines: remainingDeliveryLines,
    moveLineUpdates: dedupeMoveLineUpdatesByLineId(moveLineUpdates),
  };
}

/** Get picking(s) for a sale order with move_ids and backorder_ids for delivery flow */
/** Outgoing transfers for a sale order, oldest first (parent delivery before backorders). */
export const getPickingBySaleOrder = (saleOrderId) =>
  callOdoo(
    "stock.picking",
    "search_read",
    [[["sale_id", "=", saleOrderId]]],
    {
      fields: ["id", "name", "state", "move_ids", "backorder_ids", "picking_type_code"],
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
      // quantity_done / sale_line_id required for coverage asserts + S09189 backorder reconcile
      fields: [
        "id",
        "product_uom_qty",
        "product_id",
        "state",
        "quantity_done",
        "sale_line_id",
        "picking_id",
      ],
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

async function consumeStockValidateWizards(pickingId, result, mergedContext, depth = 0) {
  if (depth > 4) return result;
  const actionModel = String(result?.res_model || "").toLowerCase();
  const wizardId = Number(result?.res_id);
  if (!actionModel.startsWith("stock.") || !Number.isFinite(wizardId) || wizardId <= 0) {
    return result;
  }

  const wizardContext = {
    ...mergedContext,
    cancel_backorder: true,
    skip_backorder: true,
    skip_immediate: true,
  };

  let next = result;
  if (actionModel === "stock.backorder.confirmation") {
    try {
      next = await callOdooArgsKwargs(
        "stock.backorder.confirmation",
        "process_cancel_backorder",
        [[wizardId]],
        { context: wizardContext }
      );
    } catch (_) {
      // Never fall back to process() — that creates a Ready remainder backorder (S09924).
      next = await callOdooArgsKwargs(
        "stock.picking",
        "button_validate",
        [[pickingId]],
        { context: wizardContext }
      );
    }
    return consumeStockValidateWizards(pickingId, next, wizardContext, depth + 1);
  }

  if (actionModel === "stock.immediate.transfer") {
    try {
      next = await callOdooArgsKwargs(
        "stock.immediate.transfer",
        "process",
        [[wizardId]],
        { context: wizardContext }
      );
    } catch (_) {
      next = await callOdooArgsKwargs(
        "stock.picking",
        "button_validate",
        [[pickingId]],
        { context: wizardContext }
      );
    }
    return consumeStockValidateWizards(pickingId, next, wizardContext, depth + 1);
  }

  if (actionModel === "stock.overprocessed.transfer") {
    try {
      next = await callOdooArgsKwargs(
        "stock.overprocessed.transfer",
        "action_confirm",
        [[wizardId]],
        { context: wizardContext }
      );
    } catch (_) {
      try {
        next = await callOdooArgsKwargs(
          "stock.overprocessed.transfer",
          "process",
          [[wizardId]],
          { context: wizardContext }
        );
      } catch (_) {
        next = await callOdooArgsKwargs(
          "stock.picking",
          "button_validate",
          [[pickingId]],
          { context: wizardContext }
        );
      }
    }
    return consumeStockValidateWizards(pickingId, next, wizardContext, depth + 1);
  }

  return result;
}

/** Validate picking with context (e.g. skip_backorder to avoid backorder wizard). */
export const validatePickingWithContext = async (pickingId, context = {}) => {
  const pid = Number(pickingId);
  const mergedContext = {
    active_model: "stock.picking",
    active_id: pid,
    active_ids: [pid],
    skip_immediate: true,
    ...context,
  };
  const result = await callOdooArgsKwargs(
    "stock.picking",
    "button_validate",
    [[pid]],
    { context: mergedContext }
  );
  return consumeStockValidateWizards(pid, result, mergedContext, 0);
};

/** Create stock.move.line with qty_done (for offline sync: set delivered qty per move). */
export const createMoveLine = (pickingId, moveId, productId, qtyDone) =>
  callOdooArgs("stock.move.line", "create", [
    [{ move_id: moveId, picking_id: pickingId, product_id: productId, qty_done: Number(qtyDone) }],
  ]);

/**
 * Zero unexpected / orphan move lines on a picking that are not in the mobile product qty map.
 * Prevents demand=0 inflation lines from surviving into Done + partial SOL bind (S06821).
 */
export async function scrubUnexpectedPickingMoveLines(pickingId, expectedQtyByProduct = new Map()) {
  const pid = Number(pickingId);
  if (!Number.isFinite(pid) || pid <= 0) return { scrubbed: 0 };
  if (!(expectedQtyByProduct instanceof Map) || expectedQtyByProduct.size === 0) {
    return { scrubbed: 0 };
  }
  try {
    const stateRows = await getPickingState(pid);
    const pick = Array.isArray(stateRows) ? stateRows[0] : stateRows;
    if (String(pick?.state || "").toLowerCase() === "done") {
      return { scrubbed: 0 };
    }
  } catch (_) {
    /* if state cannot be read, still avoid mass-zero — caller should have a map */
  }
  const rows =
    (await callOdoo(
      'stock.move.line',
      'search_read',
      [[['picking_id', '=', pid]]],
      { fields: ['id', 'product_id', 'qty_done', 'move_id'], limit: 500 }
    )) || [];
  let scrubbed = 0;
  for (const ml of rows) {
    const productId = Number(Array.isArray(ml?.product_id) ? ml.product_id[0] : ml?.product_id);
    const lineId = Number(ml?.id);
    const actual = coerceDeliveredQty(ml?.qty_done);
    if (!Number.isFinite(lineId) || lineId <= 0 || !Number.isFinite(productId) || productId <= 0) continue;
    if (!Number.isFinite(actual) || actual <= 0.0001) continue;
    const expected = Number(expectedQtyByProduct.get(productId));
    if (Number.isFinite(expected) && expected > 0.0001) continue;
    // Product not in mobile snapshot (or expected 0) but Odoo has qty_done — zero it.
    try {
      await updateMoveLineQty(lineId, 0);
      scrubbed += 1;
    } catch (_) {
      /* readonly on some done transfers — verify will still fail closed */
    }
  }
  return { scrubbed };
}

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

/** Cancel transfer (used to force-close any auto-created backorders). */
export const actionCancelPicking = (pickingId) =>
  callOdooArgs("stock.picking", "action_cancel", [[pickingId]]);

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

/** Merge multiple (1, moveId, vals) commands for the same move into one command. */
function mergeMoveUpdateCommands(commands) {
  const merged = new Map();
  const passthrough = [];
  for (const cmd of commands || []) {
    if (!Array.isArray(cmd) || cmd[0] !== 1 || cmd[1] == null) {
      passthrough.push(cmd);
      continue;
    }
    const moveId = Number(cmd[1]);
    const vals = cmd[2] && typeof cmd[2] === "object" ? { ...cmd[2] } : {};
    const prev = merged.get(moveId) || {};
    merged.set(moveId, { ...prev, ...vals });
  }
  const out = [...passthrough];
  for (const [moveId, vals] of merged) {
    out.push([1, moveId, vals]);
  }
  return out;
}

/**
 * Build one stock.picking write payload from a mobile delivery block (all lines in one Odoo transaction).
 */
export function buildPickingDeliveryWritePayload({
  moveUpdates = [],
  moveLineUpdates = [],
  deliveryLines = [],
} = {}) {
  const updatedMoveIds = new Set();
  const moveLineIdsCommands = [];
  const moveIdsCommands = [];

  for (const u of moveUpdates || []) {
    if (u?.moveId == null || u?.product_uom_qty == null) continue;
    moveIdsCommands.push([1, Number(u.moveId), { product_uom_qty: Number(u.product_uom_qty) }]);
  }

  for (const u of moveLineUpdates || []) {
    if (u?.moveLineId == null || u?.qty_done == null) continue;
    moveLineIdsCommands.push([1, Number(u.moveLineId), { qty_done: Number(u.qty_done) }]);
    if (u?.moveId != null && Number.isFinite(Number(u.moveId))) {
      updatedMoveIds.add(Number(u.moveId));
    }
  }

  const qtyDoneByMoveId = new Map();
  for (const line of deliveryLines || []) {
    const moveId = line.moveId ?? line.move_id;
    const productId = line.productId ?? line.product_id;
    const qtyN = line.qty_done != null ? Number(line.qty_done) : NaN;
    if (moveId == null || productId == null || !Number.isFinite(qtyN) || qtyN <= 0) continue;
    qtyDoneByMoveId.set(Number(moveId), qtyN);
    if (!updatedMoveIds.has(Number(moveId))) {
      moveLineIdsCommands.push([
        0,
        0,
        {
          move_id: Number(moveId),
          product_id: Number(productId),
          qty_done: qtyN,
        },
      ]);
    }
  }

  const createdMoveLineForMove = new Set();
  for (const cmd of moveLineIdsCommands) {
    if (Array.isArray(cmd) && cmd[0] === 0 && cmd[2]?.move_id != null) {
      createdMoveLineForMove.add(Number(cmd[2].move_id));
    }
  }
  /** Set quantity_done only when qty was not already applied via move_line_ids (avoids double-count on retry). */
  for (const [moveId, qty] of qtyDoneByMoveId) {
    if (updatedMoveIds.has(moveId) || createdMoveLineForMove.has(moveId)) continue;
    moveIdsCommands.push([1, moveId, { quantity_done: qty }]);
  }

  const vals = {};
  const mergedMoves = mergeMoveUpdateCommands(moveIdsCommands);
  if (mergedMoves.length) vals.move_ids = mergedMoves;
  if (moveLineIdsCommands.length) vals.move_line_ids = moveLineIdsCommands;
  return vals;
}

/** One RPC: apply full picking delivery snapshot atomically on Odoo. */
export async function applyPickingDeliverySnapshotAtomic(pickingId, snapshot = {}, meta = {}) {
  const pid = Number(pickingId);
  if (!Number.isFinite(pid) || pid <= 0) return { ok: true, mode: "noop" };
  const vals = buildPickingDeliveryWritePayload(snapshot);
  if (!Object.keys(vals).length) return { ok: true, mode: "noop" };
  const ctx = {};
  if (meta.deliveryTxnId) ctx.mobile_delivery_txn_id = String(meta.deliveryTxnId);
  if (meta.deviceId) ctx.mobile_device_id = String(meta.deviceId);
  if (Object.keys(ctx).length) {
    await callOdooArgsKwargs("stock.picking", "write", [[pid], vals], { context: ctx });
  } else {
    await callOdoo("stock.picking", "write", [[pid], vals]);
  }
  return { ok: true, mode: "atomic" };
}

/**
 * Legacy per-record path when atomic picking write is rejected (older/custom Odoo).
 *
 * Critical:
 * - Never silently skip a failed product line (partial SOL bind).
 * - Prefer absolute SET (quantity_done / existing move.line write) over createMoveLine.
 *   createMoveLine ADDS qty and stacked on retries (S06821 GAS5 4→15).
 */
export async function applyPickingDeliverySnapshotSequential(pickingId, snapshot = {}) {
  const pid = Number(pickingId);
  // Re-enrich so retries SET existing lines instead of creating duplicates.
  let enriched = await enrichDeliverySnapshotWithExistingMoveLines(pid, snapshot);
  enriched = await stripDownwardQtyWritesIfPickingDone(pid, enriched);
  if (!snapshotHasQtyWrites(enriched)) return { ok: true, mode: "done_protected" };
  const { moveUpdates = [], moveLineUpdates = [], deliveryLines = [] } = enriched;
  for (const u of moveUpdates || []) {
    if (u?.moveId == null || u?.product_uom_qty == null) continue;
    await updateStockMoveQty(u.moveId, u.product_uom_qty);
  }
  const updatedMoveIds = new Set();
  for (const u of moveLineUpdates || []) {
    if (u?.moveLineId == null || u?.qty_done == null) continue;
    await updateMoveLineQty(u.moveLineId, u.qty_done);
    if (u?.moveId != null && Number.isFinite(Number(u.moveId))) {
      updatedMoveIds.add(Number(u.moveId));
    }
  }
  const lineErrors = [];
  for (const line of deliveryLines || []) {
    const moveId = line.moveId ?? line.move_id;
    const productId = line.productId ?? line.product_id;
    const qtyN = coerceDeliveredQty(line.qty_done);
    if (moveId == null || productId == null || !Number.isFinite(qtyN) || qtyN < 0) continue;
    if (updatedMoveIds.has(Number(moveId))) continue;
    // Absolute SET first — never create-add when a move already exists.
    try {
      await updateStockMoveQuantityDone(Number(moveId), qtyN);
      updatedMoveIds.add(Number(moveId));
      continue;
    } catch (qtyErr) {
      try {
        // Last resort: create one line only if SET failed (e.g. no move line yet).
        // Caller must not retry-create on success path.
        const existing = await getStockMoveLinesByMoveIds([Number(moveId)]).catch(() => []);
        if (Array.isArray(existing) && existing.length > 0) {
          const keeper = pickKeeperMoveLine(existing) || existing[0];
          await updateMoveLineQty(keeper.id, qtyN);
          for (const row of existing) {
            if (Number(row?.id) === Number(keeper.id)) continue;
            const extraQty = coerceDeliveredQty(row?.qty_done);
            if (!Number.isFinite(extraQty) || extraQty <= 0.0001) continue;
            await updateMoveLineQty(row.id, 0);
          }
          updatedMoveIds.add(Number(moveId));
          continue;
        }
        await createMoveLine(pid, Number(moveId), Number(productId), qtyN);
        updatedMoveIds.add(Number(moveId));
      } catch (createErr) {
        lineErrors.push(
          createErr ||
            qtyErr ||
            new Error(`Failed to set qty_done for move ${moveId} product ${productId}`)
        );
        if (__DEV__) {
          console.warn(
            `[delivery] sequential qty apply failed move ${moveId}:`,
            createErr?.message || createErr
          );
        }
      }
    }
  }
  if (lineErrors.length > 0) {
    throw lineErrors[0];
  }
  return { ok: true, mode: "sequential" };
}

const QTY_DONE_MATCH_TOL = 0.02;

/**
 * Hard guard: never reduce qty on a Done transfer.
 * Later heal/retry (hours after validate) was writing 23→0 and locking Delivered tab.
 * Upward repair (Done with 0, mobile still has qty) is still allowed.
 */
async function stripDownwardQtyWritesIfPickingDone(pickingId, snapshot = {}) {
  const pid = Number(pickingId);
  if (!Number.isFinite(pid) || pid <= 0) return snapshot;
  const stateRows = await getPickingState(pid).catch(() => []);
  const pick = Array.isArray(stateRows) ? stateRows[0] : stateRows;
  if (String(pick?.state || "").toLowerCase() !== "done") return snapshot;

  const moves = await getStockMovesByPickingId(pid).catch(() => []);
  const qtyByMove = new Map();
  const moveIds = [];
  for (const mv of moves || []) {
    const mid = Number(mv?.id);
    if (!Number.isFinite(mid) || mid <= 0) continue;
    moveIds.push(mid);
    const q = coerceDeliveredQty(mv?.quantity_done != null ? mv.quantity_done : mv?.qty_done);
    qtyByMove.set(mid, Number.isFinite(q) ? q : 0);
  }
  const lineRows = moveIds.length ? await getStockMoveLinesByMoveIds(moveIds).catch(() => []) : [];
  const qtyByLine = new Map();
  for (const ml of lineRows || []) {
    const lid = Number(ml?.id);
    const q = coerceDeliveredQty(ml?.qty_done);
    if (Number.isFinite(lid) && lid > 0) qtyByLine.set(lid, Number.isFinite(q) ? q : 0);
  }

  const keepIfNotReducing = (current, target) => {
    const cur = Number.isFinite(current) ? current : 0;
    const tgt = coerceDeliveredQty(target);
    if (cur > 0.0001 && (!Number.isFinite(tgt) || tgt + QTY_DONE_MATCH_TOL < cur)) {
      return false;
    }
    return true;
  };

  const deliveryLines = (snapshot.deliveryLines || []).filter((line) => {
    const mid = Number(line?.moveId ?? line?.move_id);
    return keepIfNotReducing(qtyByMove.get(mid) || 0, line?.qty_done);
  });
  const moveLineUpdates = (snapshot.moveLineUpdates || []).filter((u) => {
    const lid = Number(u?.moveLineId);
    const mid = Number(u?.moveId);
    const current =
      (Number.isFinite(lid) && qtyByLine.has(lid) ? qtyByLine.get(lid) : null) ??
      (Number.isFinite(mid) ? qtyByMove.get(mid) : 0) ??
      0;
    return keepIfNotReducing(current, u?.qty_done);
  });

  return {
    ...snapshot,
    moveUpdates: [],
    deliveryLines,
    moveLineUpdates,
  };
}

function snapshotHasQtyWrites(snapshot = {}) {
  return (
    (Array.isArray(snapshot.deliveryLines) && snapshot.deliveryLines.length > 0) ||
    (Array.isArray(snapshot.moveLineUpdates) && snapshot.moveLineUpdates.length > 0) ||
    (Array.isArray(snapshot.moveUpdates) && snapshot.moveUpdates.length > 0)
  );
}

/** True when Odoo already matches the mobile snapshot (skip re-write on queue retry/heal). */
export async function pickingDeliverySnapshotAlreadyApplied(pickingId, snapshot = {}, tolerance = QTY_DONE_MATCH_TOL) {
  const pid = Number(pickingId);
  if (!Number.isFinite(pid) || pid <= 0) return false;
  const { deliveryLines = [], moveLineUpdates = [] } = snapshot;
  const expectedByMove = new Map();
  for (const line of deliveryLines || []) {
    const mid = Number(line?.moveId ?? line?.move_id);
    const qty = Number(line?.qty_done);
    if (!Number.isFinite(mid) || mid <= 0 || !Number.isFinite(qty) || qty <= 0) continue;
    const prev = expectedByMove.get(mid);
    expectedByMove.set(mid, prev == null ? qty : Math.max(prev, qty));
  }
  for (const u of moveLineUpdates || []) {
    const mid = Number(u?.moveId);
    const qty = Number(u?.qty_done);
    if (!Number.isFinite(mid) || mid <= 0 || !Number.isFinite(qty) || qty <= 0) continue;
    const prev = expectedByMove.get(mid);
    expectedByMove.set(mid, prev == null ? qty : Math.max(prev, qty));
  }
  if (expectedByMove.size === 0) return false;

  const moves = await getStockMovesByPickingId(pid).catch(() => []);
  const moveIds = [...expectedByMove.keys()];
  let moveRows = [];
  try {
    moveRows =
      (await callOdoo("stock.move", "read", [moveIds], { fields: ["id", "quantity_done"] })) || [];
  } catch (_) {
    moveRows = [];
  }
  const moveById = new Map((Array.isArray(moveRows) ? moveRows : []).map((m) => [Number(m.id), m]));

  for (const [mid, expected] of expectedByMove) {
    let actual = NaN;
    const mv = moveById.get(mid);
    if (mv?.quantity_done != null) actual = Number(mv.quantity_done);
    if (!Number.isFinite(actual)) {
      const mls = await getStockMoveLinesByMoveIds([mid]).catch(() => []);
      actual = (mls || []).reduce((sum, ml) => sum + (Number(ml?.qty_done) || 0), 0);
    }
    if (!Number.isFinite(actual) || Math.abs(actual - expected) > tolerance) return false;
  }
  return true;
}

/** Idempotent: skip Odoo write when snapshot already matches; otherwise atomic write + sequential fallback. */
export async function applyPickingDeliverySnapshotIdempotent(pickingId, snapshot = {}, meta = {}) {
  const pid = Number(pickingId);
  if (!Number.isFinite(pid) || pid <= 0) return { ok: true, mode: "noop" };
  let enriched = await enrichDeliverySnapshotWithExistingMoveLines(pid, snapshot);
  enriched = await stripDownwardQtyWritesIfPickingDone(pid, enriched);
  if (!snapshotHasQtyWrites(enriched)) return { ok: true, mode: "done_protected" };
  if (await pickingDeliverySnapshotAlreadyApplied(pid, enriched)) {
    return { ok: true, mode: "already_applied" };
  }
  return applyPickingDeliverySnapshotWithFallback(pid, enriched, meta);
}

/** Atomic picking write with safe fallback to the legacy per-line sequence. */
export async function applyPickingDeliverySnapshotWithFallback(pickingId, snapshot = {}, meta = {}) {
  const pid = Number(pickingId);
  if (!Number.isFinite(pid) || pid <= 0) return { ok: true, mode: "noop" };
  let enriched = await enrichDeliverySnapshotWithExistingMoveLines(pid, snapshot);
  enriched = await stripDownwardQtyWritesIfPickingDone(pid, enriched);
  if (!snapshotHasQtyWrites(enriched)) return { ok: true, mode: "done_protected" };
  if (await pickingDeliverySnapshotAlreadyApplied(pid, enriched)) {
    return { ok: true, mode: "already_applied" };
  }
  try {
    return await applyPickingDeliverySnapshotAtomic(pickingId, enriched, meta);
  } catch (atomicErr) {
    if (__DEV__) {
      console.warn(
        `[delivery] atomic picking write failed for ${pickingId}, using sequential:`,
        atomicErr?.message || atomicErr
      );
    }
    return applyPickingDeliverySnapshotSequential(pickingId, enriched);
  }
}

/** Read current Odoo qty_done / qty_delivered for audit comparison (does not throw). */
export async function fetchOdooDeliveredQtySnapshot(pickingBlocks = [], deliveredUpdates = []) {
  const byMove = {};
  const bySoLine = {};
  const moveTarget = new Map();
  for (const b of pickingBlocks || []) {
    for (const line of b.deliveryLines || []) {
      const mid = Number(line?.moveId ?? line?.move_id);
      const qty = coerceDeliveredQty(line?.qty_done);
      if (Number.isFinite(mid) && mid > 0 && Number.isFinite(qty)) moveTarget.set(mid, qty);
    }
    for (const u of b.moveLineUpdates || []) {
      const mid = Number(u?.moveId);
      const qty = coerceDeliveredQty(u?.qty_done);
      if (Number.isFinite(mid) && mid > 0 && Number.isFinite(qty)) moveTarget.set(mid, qty);
    }
  }
  const moveIds = [...moveTarget.keys()];
  if (moveIds.length) {
    try {
      const moveRows =
        (await callOdoo('stock.move', 'read', [moveIds], { fields: ['id', 'quantity_done'] })) || [];
      for (const mv of Array.isArray(moveRows) ? moveRows : []) {
        const mid = Number(mv?.id);
        let actual = coerceDeliveredQty(mv?.quantity_done);
        if (!Number.isFinite(actual)) {
          const mls = await getStockMoveLinesByMoveIds([mid]).catch(() => []);
          actual = coerceDeliveredQty(
            (mls || []).reduce((sum, ml) => sum + (Number(ml?.qty_done) || 0), 0)
          );
        }
        byMove[String(mid)] = {
          mobile: moveTarget.get(mid),
          odoo: actual,
        };
      }
    } catch (_) {
      /* audit read is best-effort */
    }
  }

  const lineIds = [
    ...new Set(
      (deliveredUpdates || [])
        .map((u) => Number(u?.lineId))
        .filter((n) => Number.isFinite(n) && n > 0)
    ),
  ];
  if (lineIds.length) {
    try {
      const rows =
        (await callOdoo('sale.order.line', 'read', [lineIds], { fields: ['id', 'qty_delivered'] })) || [];
      const expById = new Map(
        (deliveredUpdates || []).map((u) => [Number(u.lineId), coerceDeliveredQty(u.qty_delivered)])
      );
      for (const row of Array.isArray(rows) ? rows : []) {
        const lid = Number(row?.id);
        bySoLine[String(lid)] = {
          mobile: expById.get(lid),
          odoo: coerceDeliveredQty(row?.qty_delivered),
        };
      }
    } catch (_) {
      /* non-fatal */
    }
  }

  return { byMove, bySoLine, readAt: new Date().toISOString() };
}

/**
 * Offline-first scaffolding when Odoo delivery/picking rows were never pulled locally.
 * Creates synthetic stock_picking + stock_moves (+ empty move lines) from sale.order.lines
 * so Save / Proceed can work without network. Upload remaps synthetic ids via sale_id.
 *
 * @returns {Promise<Array>} local picking rows (synthetic or existing)
 */
export async function materializeLocalDeliveryScaffoldForSaleOrder(saleOrderId) {
  const soId = Number(saleOrderId);
  if (!Number.isFinite(soId) || soId <= 0) return [];

  const stockPickingsDb = await import('../database/stockPickings.js');
  const stockMovesDb = await import('../database/stockMoves.js');
  const stockMoveLinesDb = await import('../database/stockMoveLines.js');
  const saleOrderLinesDb = await import('../database/saleOrderLines.js');

  let pickings = await stockPickingsDb.getStockPickingsBySaleId(soId);
  if (Array.isArray(pickings) && pickings.length > 0) {
    // Ensure moves cover EVERY ordered SO product — "any moves exist" caused partial delivery (S09080).
    const linesEarly = (await saleOrderLinesDb.getSaleOrderLinesByOrderIds([soId]).catch(() => [])) || [];
    const needed = new Set();
    for (const l of linesEarly) {
      const pid = Array.isArray(l.product_id) ? Number(l.product_id[0]) : Number(l.product_id);
      const ordered = Number(l.product_uom_qty) || 0;
      if (Number.isFinite(pid) && pid > 0 && ordered > 0.0001) needed.add(pid);
    }
    const have = new Set();
    let anyMoves = false;
    for (const pk of pickings) {
      const moves = await stockMovesDb.getStockMovesByPickingId(pk.id).catch(() => []);
      if (!Array.isArray(moves) || moves.length === 0) continue;
      anyMoves = true;
      for (const mv of moves) {
        const pid = Array.isArray(mv.product_id) ? Number(mv.product_id[0]) : Number(mv.product_id);
        if (Number.isFinite(pid) && pid > 0) have.add(pid);
      }
    }
    if (anyMoves && (needed.size === 0 || [...needed].every((pid) => have.has(pid)))) {
      return pickings;
    }
  }

  const lines = (await saleOrderLinesDb.getSaleOrderLinesByOrderIds([soId]).catch(() => [])) || [];
  const usableLines = lines.filter((l) => {
    const pid = Array.isArray(l.product_id) ? Number(l.product_id[0]) : Number(l.product_id);
    return Number.isFinite(pid) && pid > 0;
  });
  if (!usableLines.length) return [];

  // Stable negative ids scoped to SO — never collide with real Odoo ids (>0).
  const pickingId = -(1_000_000_000 + soId);
  const moveIds = [];
  const moveRows = usableLines.map((l, idx) => {
    const productId = Array.isArray(l.product_id) ? Number(l.product_id[0]) : Number(l.product_id);
    const productName = Array.isArray(l.product_id) ? l.product_id[1] : l.name || '';
    const moveId = -(2_000_000_000 + soId * 100 + idx);
    moveIds.push(moveId);
    return {
      id: moveId,
      picking_id: pickingId,
      product_id: [productId, productName || ''],
      product_uom_qty: Number(l.product_uom_qty) || 0,
      state: 'assigned',
    };
  });
  const moveLineRows = moveIds.map((moveId, idx) => ({
    id: -(3_000_000_000 + soId * 100 + idx),
    move_id: moveId,
    qty_done: 0,
  }));

  await stockPickingsDb.upsertStockPickings([
    {
      id: pickingId,
      name: `OFFLINE/${soId}`,
      sale_id: [soId, null],
      state: 'assigned',
      move_ids: moveIds,
      backorder_ids: [],
    },
  ]);
  await stockMovesDb.upsertStockMoves(moveRows);
  await stockMoveLinesDb.upsertStockMoveLines(moveLineRows);

  pickings = await stockPickingsDb.getStockPickingsBySaleId(soId);
  return Array.isArray(pickings) ? pickings : [];
}
