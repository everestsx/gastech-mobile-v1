/**
 * Local CRUD for stock_pickings (Odoo stock.picking mirror).
 */
import { getDb } from './db.js';
import { empty, num, numOrNull, iso, jsonArr } from './dbHelpers.js';

export async function upsertStockPickings(rows) {
  if (!rows?.length) return;
  const db = await getDb();
  const now = iso();
  await db.withTransactionAsync(async (tx) => {
    for (const r of rows) {
      const saleId = Array.isArray(r.sale_id) ? r.sale_id[0] : r.sale_id;
      await tx.runAsync(
        `INSERT OR REPLACE INTO stock_pickings (
          id, name, sale_id, state, move_ids, backorder_ids, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          num(r.id),
          empty(r.name) || null,
          numOrNull(saleId),
          empty(r.state) || null,
          jsonArr(r.move_ids),
          jsonArr(r.backorder_ids),
          now,
        ]
      );
    }
  });
}

export async function getStockPickingsBySaleId(saleOrderId) {
  const db = await getDb();
  const rows = await db.getAllAsync(
    'SELECT * FROM stock_pickings WHERE sale_id = ? ORDER BY id LIMIT 20',
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
  const db = await getDb();
  await db.runAsync(
    'UPDATE stock_pickings SET state = ?, updated_at = ? WHERE id = ?',
    [empty(state) || 'done', iso(), num(pickingId)]
  );
}
