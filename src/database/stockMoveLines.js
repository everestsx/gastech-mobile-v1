/**
 * Local CRUD for stock_move_lines (Odoo stock.move.line mirror).
 */
import { getDb } from './db.js';
import { num, numOrNull, iso } from './dbHelpers.js';

export async function upsertStockMoveLines(rows) {
  if (!rows?.length) return;
  const db = await getDb();
  const now = iso();
  await db.withTransactionAsync(async (tx) => {
    for (const r of rows) {
      const moveId = Array.isArray(r.move_id) ? r.move_id[0] : r.move_id;
      await tx.runAsync(
        `INSERT OR REPLACE INTO stock_move_lines (id, move_id, qty_done, updated_at) VALUES (?, ?, ?, ?)`,
        [num(r.id), numOrNull(moveId), num(r.qty_done), now]
      );
    }
  });
}

export async function getStockMoveLinesByMoveIds(moveIds) {
  if (!moveIds?.length) return [];
  const db = await getDb();
  const placeholders = moveIds.map(() => '?').join(',');
  const rows = await db.getAllAsync(
    `SELECT * FROM stock_move_lines WHERE move_id IN (${placeholders})`,
    moveIds
  );
  return (rows || []).map((row) => ({
    id: row.id,
    move_id: [row.move_id, null],
    qty_done: row.qty_done,
  }));
}

export async function updateMoveLineQtyLocal(lineId, qty) {
  const db = await getDb();
  await db.runAsync(
    'UPDATE stock_move_lines SET qty_done = ?, updated_at = ? WHERE id = ?',
    [num(qty), iso(), num(lineId)]
  );
}
