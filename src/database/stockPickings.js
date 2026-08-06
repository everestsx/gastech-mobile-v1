/**
 * Local CRUD for stock_pickings (Odoo stock.picking mirror).
 */

import { getDb } from './db.js';
import { empty, num, numOrNull, iso, jsonArr, normalizeOdooRelationIds } from './dbHelpers.js';

const LOG = '[stockPickings]';

function logQuery(operation, detail = '') {
  if (detail) console.log(`${LOG} ${operation} ${detail}`);
  else console.log(`${LOG} ${operation}`);
}

function logError(operation, paramsSummary, err) {
  console.warn(`${LOG} ${operation} failed`, paramsSummary, err?.message ?? err);
}
/**
 * @param {Array} rows - Pickings from Odoo (or merged).
 * @param {{ preserveLocalStateForSaleOrderIds?: Set<number> | number[] }} [options] - When set, for pickings whose sale_id is in this set we keep existing local state (so sync download does not overwrite e.g. 'done' with Odoo value).
 */
export async function upsertStockPickings(rows, options = {}) {
  if (!rows?.length) return;
  const db = await getDb();
  const now = iso();
  const preserveSet = options.preserveLocalStateForSaleOrderIds;
  const preserveIds = preserveSet instanceof Set ? Array.from(preserveSet) : (Array.isArray(preserveSet) ? preserveSet : []);

  await db.withTransactionAsync(async (tx) => {
    let stateByPickingId = {};
    if (preserveIds.length > 0) {
      const placeholders = preserveIds.map(() => '?').join(',');
      const localRows = await tx.getAllAsync(
        `SELECT id, state FROM stock_pickings WHERE sale_id IN (${placeholders})`,
        preserveIds
      );
      for (const row of localRows || []) {
        stateByPickingId[num(row.id)] = row.state ?? '';
      }
    }

    for (const r of rows) {
      const saleId = Array.isArray(r.sale_id) ? r.sale_id[0] : r.sale_id;
      const sid = numOrNull(saleId);
      const useLocal = preserveIds.length > 0 && sid != null && preserveIds.includes(sid) && stateByPickingId[num(r.id)] !== undefined;
      const stateVal = useLocal ? (stateByPickingId[num(r.id)] ?? '') : (empty(r.state) || null);

      await tx.runAsync(
        `INSERT OR REPLACE INTO stock_pickings (
          id, name, sale_id, state, move_ids, backorder_ids, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          num(r.id),
          empty(r.name) || null,
          sid,
          stateVal,
          jsonArr(normalizeOdooRelationIds(r.move_ids)),
          jsonArr(normalizeOdooRelationIds(r.backorder_ids)),
          now,
        ]
      );
    }
  });
}

export async function getStockPickingsBySaleId(saleOrderId) {
  const db = await getDb();
  const rows = await db.getAllAsync(
    // Prefer real Odoo ids (>0) over offline synthetic scaffolding (<0).
    `SELECT * FROM stock_pickings
     WHERE sale_id = ?
     ORDER BY CASE WHEN id > 0 THEN 0 ELSE 1 END, id
     LIMIT 20`,
    [saleOrderId]
  );
  return (rows || []).map((row) => ({
    id: row.id,
    name: row.name,
    state: row.state,
    move_ids: safeParseJson(row.move_ids, []),
    backorder_ids: safeParseJson(row.backorder_ids, []),
  }));
}

/** Remove offline-only synthetic picking trees once real Odoo pickings exist for the SO. */
export async function deleteSyntheticPickingsForSaleOrderIds(saleOrderIds = []) {
  const ids = [
    ...new Set(
      (saleOrderIds || [])
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id) && id > 0)
    ),
  ];
  if (!ids.length) return 0;
  const db = await getDb();
  const ph = ids.map(() => '?').join(',');
  const synthPickings = await db.getAllAsync(
    `SELECT id FROM stock_pickings WHERE sale_id IN (${ph}) AND id < 0`,
    ids
  );
  const pickingIds = (synthPickings || [])
    .map((r) => Number(r?.id))
    .filter((id) => Number.isFinite(id) && id < 0);
  if (!pickingIds.length) return 0;
  const pph = pickingIds.map(() => '?').join(',');
  const moves = await db.getAllAsync(`SELECT id FROM stock_moves WHERE picking_id IN (${pph})`, pickingIds);
  const moveIds = (moves || []).map((r) => Number(r?.id)).filter((id) => Number.isFinite(id));
  await db.withTransactionAsync(async (tx) => {
    if (moveIds.length > 0) {
      const mph = moveIds.map(() => '?').join(',');
      await tx.runAsync(`DELETE FROM stock_move_lines WHERE move_id IN (${mph})`, moveIds);
      await tx.runAsync(`DELETE FROM stock_moves WHERE id IN (${mph})`, moveIds);
    }
    await tx.runAsync(`DELETE FROM stock_pickings WHERE id IN (${pph})`, pickingIds);
  });
  logQuery('deleteSyntheticPickingsForSaleOrderIds', `removed ${pickingIds.length} for ${ids.length} SO(s)`);
  return pickingIds.length;
}

export async function getStockPickingsBySaleIds(saleOrderIds) {
  if (!saleOrderIds?.length) return [];
  const db = await getDb();
  const placeholders = saleOrderIds.map(() => '?').join(',');
  const rows = await db.getAllAsync(
    `SELECT id, sale_id, state FROM stock_pickings WHERE sale_id IN (${placeholders})`,
    saleOrderIds
  );
  return (rows || []).map((row) => ({
    id: row.id,
    sale_id: [row.sale_id, null],
    state: row.state,
  }));
}

function safeParseJson(str, fallback) {
  if (str == null || str === '') return fallback;
  try {
    const v = JSON.parse(str);
    return Array.isArray(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Update picking state locally (offline). e.g. 'done' after delivery validation.
 */
export async function updatePickingStateLocal(pickingId, state) {
  console.log('updatePickingStateLocal', pickingId, state);
  const op = 'updatePickingStateLocal';
  logQuery(op, `pickingId=${pickingId} state=${state}`);
  const db = await getDb();
  const stateStr = typeof state === 'string' && state ? state : 'done';
  const nowStr = iso();
  const idNum = num(pickingId);
  await db.runAsync(
    'UPDATE stock_pickings SET state = ?, updated_at = ? WHERE id = ?',
    [stateStr, nowStr, idNum]
  );
  logQuery(op, `done pickingId=${pickingId}`);
}
