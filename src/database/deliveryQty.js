/**
 * Aggregate qty_done from stock.move.line per sale order (local DB).
 * Used for progress UI: partial delivery counts even when picking is not yet validated on Odoo.
 */
import { getDb } from './db.js';
import { num } from './dbHelpers.js';

/**
 * @param {number[]} saleOrderIds
 * @returns {Promise<Record<number, number>>} sale_order_id -> sum of qty_done
 */
export async function getTotalQtyDoneBySaleOrderIds(saleOrderIds) {
  if (!Array.isArray(saleOrderIds) || saleOrderIds.length === 0) return {};
  const ids = [...new Set(saleOrderIds.map((x) => num(x)).filter((n) => n > 0))];
  if (ids.length === 0) return {};
  const db = await getDb();
  const placeholders = ids.map(() => '?').join(',');
  const rows = await db.getAllAsync(
    `SELECT p.sale_id AS sale_order_id, SUM(COALESCE(ml.qty_done, 0)) AS total_done
     FROM stock_pickings p
     INNER JOIN stock_moves m ON m.picking_id = p.id
     INNER JOIN stock_move_lines ml ON ml.move_id = m.id
     WHERE p.sale_id IN (${placeholders})
     GROUP BY p.sale_id`,
    ids
  );
  const out = {};
  for (const r of rows || []) {
    const sid = num(r.sale_order_id);
    if (sid > 0) out[sid] = num(r.total_done);
  }
  return out;
}

/**
 * Per (sale_order_id, product_id) sum of qty_done from move lines (for delivered-tab line badges).
 * @param {number[]} saleOrderIds
 * @returns {Promise<Record<number, Record<number, number>>>} soId -> productId -> qty
 */
export async function getQtyDoneBySaleOrderProductMap(saleOrderIds) {
  if (!Array.isArray(saleOrderIds) || saleOrderIds.length === 0) return {};
  const ids = [...new Set(saleOrderIds.map((x) => num(x)).filter((n) => n > 0))];
  if (ids.length === 0) return {};
  const db = await getDb();
  const placeholders = ids.map(() => '?').join(',');
  const rows = await db.getAllAsync(
    `SELECT p.sale_id AS sale_order_id, m.product_id AS product_id,
            SUM(COALESCE(ml.qty_done, 0)) AS done
     FROM stock_pickings p
     INNER JOIN stock_moves m ON m.picking_id = p.id
     INNER JOIN stock_move_lines ml ON ml.move_id = m.id
     WHERE p.sale_id IN (${placeholders})
     GROUP BY p.sale_id, m.product_id`,
    ids
  );
  const out = {};
  for (const r of rows || []) {
    const sid = num(r.sale_order_id);
    const pid = num(r.product_id);
    if (sid <= 0 || pid <= 0) continue;
    if (!out[sid]) out[sid] = {};
    out[sid][pid] = num(r.done);
  }
  return out;
}
