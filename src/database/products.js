/**
 * Local CRUD for products (from Odoo product_id on lines/moves).
 */
import { getDb } from './db.js';
import { empty, num, iso } from './dbHelpers.js';

function odooRel(idName) {
  if (Array.isArray(idName)) return { id: idName[0], name: idName[1] ?? null };
  return { id: idName, name: null };
}

function imageBase64ToDataUri(value) {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^data:image\//i.test(raw)) return raw;

  const clean = raw.replace(/\s+/g, '');
  if (!clean) return null;

  let mime = 'image/png';
  if (clean.startsWith('/9j/')) mime = 'image/jpeg';
  else if (clean.startsWith('R0lGOD')) mime = 'image/gif';
  else if (clean.startsWith('UklGR')) mime = 'image/webp';

  return `data:${mime};base64,${clean}`;
}

export async function upsertProducts(rows) {
  if (!rows?.length) return;
  const db = await getDb();
  const now = iso();
  await db.withTransactionAsync(async (tx) => {
    for (const r of rows) {
      const product = typeof r === 'object' && (r.id != null || r.product_id != null)
        ? {
          id: r.id ?? (Array.isArray(r.product_id) ? r.product_id[0] : r.product_id),
          name: r.name ?? (Array.isArray(r.product_id) ? r.product_id[1] : null),
          type: r.type ?? null,
          image_1920: r.image_1920 ?? null,
        }
        : odooRel(r);
      const id = num(product.id);
      if (id === 0) continue;
      await tx.runAsync(
        `INSERT OR REPLACE INTO products (id, name, list_price, type, image_1920, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
        [id, empty(product.name), num(product.list_price), empty(product.type), empty(product.image_1920), now]
      );
    }
  });
}

export async function getProductById(id) {
  const db = await getDb();
  const row = await db.getFirstAsync('SELECT * FROM products WHERE id = ?', [id]);
  return row ? { id: row.id, name: row.name, list_price: row.list_price, image_1920: row.image_1920 } : null;
}

/**
 * REG, PACK, HOSE must always appear on the tax invoice row table (qty 0 if not sold).
 * Odoo types may differ from `consu`; include by id regardless. Order: REG → PACK → HOSE after gas lines (see sortInvoiceLinesByGasKgAsc).
 */
export const INVOICE_ACCESSORY_PRODUCT_IDS = Object.freeze([44, 43, 38]);

const INVOICE_ACCESSORY_FALLBACK_ROWS = Object.freeze([
  { id: 44, name: 'REG', list_price: 1200 },
  { id: 43, name: 'PACK', list_price: 2658.474 },
  { id: 38, name: 'HOSE', list_price: 300 },
]);

/** Ensures accessory catalog rows exist when products are missing from SQLite (offline / not synced yet). */
export function mergeInvoiceAccessoryCatalogStubs(products) {
  const list = Array.isArray(products) ? [...products] : [];
  const seen = new Set(list.map((p) => num(p?.id)).filter((id) => id > 0));
  for (const stub of INVOICE_ACCESSORY_FALLBACK_ROWS) {
    if (seen.has(stub.id)) continue;
    list.push({ ...stub, type: 'consu' });
    seen.add(stub.id);
  }
  return list;
}

/** Full product list for catalog-style invoice rows (all products with unit price). */
export async function getAllProductsForInvoice() {
  const db = await getDb();
  const acc = [...INVOICE_ACCESSORY_PRODUCT_IDS];
  const ph = acc.map(() => '?').join(', ');
  const rows = await db.getAllAsync(
    `SELECT id, name, list_price, type
     FROM products
     WHERE LOWER(COALESCE(type, '')) = 'consu'
        OR id IN (${ph})
     ORDER BY name COLLATE NOCASE ASC, id ASC`,
    acc
  );
  const mapped = (rows || []).map((r) => ({
    id: r.id,
    name: r.name ?? '',
    list_price: num(r.list_price),
    type: r.type ?? '',
  }));
  return mergeInvoiceAccessoryCatalogStubs(mapped);
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

/** @returns {Promise<Record<number, string>>} Map product id -> data URI built from image_1920. */
export async function getProductImageUriMap() {
  const db = await getDb();
  const rows = await db.getAllAsync("SELECT id, image_1920 FROM products WHERE image_1920 IS NOT NULL AND TRIM(image_1920) <> ''");
  const map = {};
  (rows || []).forEach((r) => {
    if (r.id == null) return;
    const uri = imageBase64ToDataUri(r.image_1920);
    if (uri) map[r.id] = uri;
  });
  return map;
}
