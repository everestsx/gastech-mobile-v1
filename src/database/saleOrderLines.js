/**
 * Local CRUD for sale_order_lines (Odoo sale.order.line mirror).
 */
import { getDb } from './db.js';
import { empty, num, numOrNull, iso } from './dbHelpers.js';
import { getProductsMap } from './products.js';

function odooRel(idName) {
  if (Array.isArray(idName)) return { id: idName[0], name: idName[1] ?? null };
  return { id: idName, name: null };
}

export async function upsertSaleOrderLines(rows) {
  if (!rows?.length) return;
  const db = await getDb();
  const now = iso();
  await db.withTransactionAsync(async (tx) => {
    for (const r of rows) {
      const orderId = Array.isArray(r.order_id) ? r.order_id[0] : r.order_id;
      const product = odooRel(r.product_id);
      await tx.runAsync(
        `INSERT OR REPLACE INTO sale_order_lines (
          id, order_id, product_id, product_name, name, product_uom_qty,
          price_unit, price_subtotal, price_total, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          num(r.id),
          numOrNull(orderId),
          numOrNull(product.id),
          empty(product.name),
          empty(r.name),
          num(r.product_uom_qty),
          num(r.price_unit),
          num(r.price_subtotal),
          num(r.price_total),
          now,
        ]
      );
    }
  });
}

export async function getSaleOrderLinesByOrderIds(orderIds) {
  if (!orderIds?.length) return [];
  const db = await getDb();
  const placeholders = orderIds.map(() => '?').join(',');
  const rows = await db.getAllAsync(
    `SELECT * FROM sale_order_lines WHERE order_id IN (${placeholders}) ORDER BY id`,
    orderIds
  );
  const productNames = await getProductsMap();
  return (rows || []).map((row) => {
    const productName = (row.product_name && String(row.product_name).trim()) || productNames[row.product_id] || '';
    return {
      id: row.id,
      order_id: [row.order_id, null],
      product_id: [row.product_id, productName],
      name: row.name,
      product_uom_qty: row.product_uom_qty,
      price_unit: row.price_unit,
      price_subtotal: row.price_subtotal,
      price_total: row.price_total,
    };
  });
}

/**
 * Update one sale order line quantity locally (offline). Recomputes price_subtotal and price_total, preserving tax proportionally.
 */
export async function updateSaleOrderLineQtyLocal(lineId, qty) {
  const db = await getDb();
  const qtyNum = num(qty);
  const row = await db.getFirstAsync(
    'SELECT id, price_unit, price_subtotal, price_total, product_uom_qty FROM sale_order_lines WHERE id = ?',
    [num(lineId)]
  );
  if (!row) return;
  const priceUnit = num(row.price_unit);
  const priceSubtotal = qtyNum * priceUnit;
  const oldSubtotal = num(row.price_subtotal);
  const oldTotal = num(row.price_total);
  const oldQty = num(row.product_uom_qty) || 1;
  const lineTax = oldTotal - oldSubtotal;
  const taxPerUnit = oldQty ? lineTax / oldQty : 0;
  const priceTotal = priceSubtotal + taxPerUnit * qtyNum;
  await db.runAsync(
    `UPDATE sale_order_lines SET product_uom_qty = ?, price_subtotal = ?, price_total = ?, updated_at = ? WHERE id = ?`,
    [qtyNum, priceSubtotal, priceTotal, iso(), num(lineId)]
  );
}
