/**
 * Local CRUD for products (from Odoo product_id on lines/moves).
 */
import { getDb } from './db.js';
import { empty, num, iso } from './dbHelpers.js';

function odooRel(idName) {
  if (Array.isArray(idName)) return { id: idName[0], name: idName[1] ?? null };
  return { id: idName, name: null };
}

export async function upsertProducts(rows) {
  if (!rows?.length) return;
  const db = await getDb();
  const now = iso();
  await db.withTransactionAsync(async (tx) => {
    for (const r of rows) {
      const product = typeof r === 'object' && (r.id != null || r.product_id != null)
        ? { id: r.id ?? (Array.isArray(r.product_id) ? r.product_id[0] : r.product_id), name: r.name ?? (Array.isArray(r.product_id) ? r.product_id[1] : null) }
        : odooRel(r);
      const id = num(product.id);
      if (id === 0) continue;
      await tx.runAsync(
        `INSERT OR REPLACE INTO products (id, name, updated_at) VALUES (?, ?, ?)`,
        [id, empty(product.name), now]
      );
    }
  });
}

export async function getProductById(id) {
  const db = await getDb();
  const row = await db.getFirstAsync('SELECT * FROM products WHERE id = ?', [id]);
  return row ? { id: row.id, name: row.name } : null;
}

/** @returns {Promise<Record<number, string>>} Map product id -> name for display (e.g. sale order cards). */
export async function getProductsMap() {
  const db = await getDb();
  const rows = await db.getAllAsync('SELECT id, name FROM products');
  const map = {};
  (rows || []).forEach((r) => {
    if (r.id != null) map[r.id] = r.name ?? '';
  });
  return map;
}
