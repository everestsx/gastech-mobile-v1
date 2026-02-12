/**
 * Local CRUD for stock_moves (Odoo stock.move mirror).
 */
import { getDb } from './db.js';
import { empty, num, numOrNull, iso } from './dbHelpers.js';

function odooRel(idName) {
  if (Array.isArray(idName)) return { id: idName[0], name: idName[1] ?? null };
  return { id: idName, name: null };
}

export async function upsertStockMoves(rows) {
  if (!rows?.length) return;
  const db = await getDb();
  const now = iso();
  await db.withTransactionAsync(async (tx) => {
    for (const r of rows) {
      const product = odooRel(r.product_id);
      await tx.runAsync(
        'INSERT OR REPLACE INTO stock_moves (id, picking_id, product_id, product_name, product_uom_qty, state, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [
          num(r.id),
          num(r.picking_id),
          numOrNull(product.id),
          empty(product.name),
          num(r.product_uom_qty),
          empty(r.state) || null,
          now,
        ]
      );
    }
  });
}

export async function getStockMovesByPickingId(pickingId) {
  const db = await getDb();
  const rows = await db.getAllAsync(
    'SELECT * FROM stock_moves WHERE picking_id = ?',
    [pickingId]
  );
  return (rows || []).map((row) => ({
    id: row.id,
    product_uom_qty: row.product_uom_qty,
    product_id: [row.product_id, row.product_name ?? ''],
    state: row.state,
  }));
}
