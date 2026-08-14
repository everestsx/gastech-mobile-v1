/**
 * Fetch products from Odoo product.product.
 * Keep sync payload lean by excluding image_1920 from routine sync pulls.
 */
import { callOdoo } from './index.service';
import { canonicalKgFromName, isEmptyCylinderName } from '../utils/cylinderCatalog';

const PRODUCT_FIELDS = ['id', 'name', 'list_price', 'qty_available', 'type'];
const PRODUCT_LIMIT = 500;

/**
 * Get all products from product.product (search_read).
 * @returns {Promise<Array<{ id: number, name: string, list_price?: number, qty_available?: number, image_1920?: string }>>}
 */
export const getAllProducts = () =>
  callOdoo('product.product', 'search_read', [[]], {
    fields: PRODUCT_FIELDS,
    limit: PRODUCT_LIMIT,
  });

/**
 * Get products by ids (for vehicle-scoped sync; avoids fetching all products).
 * @param {number[]} ids
 * @returns {Promise<Array<{ id: number, name: string, list_price?: number, qty_available?: number, image_1920?: string }>>}
 */
export const getProductsByIds = (ids) => {
  if (!ids?.length) return Promise.resolve([]);
  return callOdoo('product.product', 'search_read', [[['id', 'in', ids]]], {
    fields: PRODUCT_FIELDS,
    limit: ids.length,
  });
};

/**
 * Fetch mandatory empty-cylinder products by canonical kg labels.
 * Keeps empty-cylinder mapping available even when order-targeted product sync omits them.
 * Broad "empty" search first so names like "Empty Cylinder 12.5 kg" still match;
 * per-size `Empty ${kg}` is only used for sizes still missing.
 */
export const getMandatoryEmptyCylinderProducts = async (kgSizes = [2.4, 5, 12.5, 37.5]) => {
  const wanted = (kgSizes || []).map((kg) => Number(kg)).filter((n) => Number.isFinite(n));
  if (!wanted.length) return [];

  const out = [];
  const seen = new Set();
  const matchedKg = new Set();

  const takeRows = (rows) => {
    for (const r of rows || []) {
      const id = Number(r?.id);
      if (!Number.isFinite(id) || seen.has(id)) continue;
      if (!isEmptyCylinderName(r?.name)) continue;
      const kg = canonicalKgFromName(r?.name);
      if (kg == null) continue;
      if (!wanted.some((w) => Math.abs(w - kg) < 0.051)) continue;
      seen.add(id);
      matchedKg.add(kg);
      out.push(r);
    }
  };

  try {
    const broad = await callOdoo('product.product', 'search_read', [[['name', 'ilike', 'empty']]], {
      fields: PRODUCT_FIELDS,
      limit: 80,
    });
    takeRows(broad);
  } catch {
    // Per-size search below still runs.
  }

  for (const kg of wanted) {
    if ([...matchedKg].some((m) => Math.abs(m - kg) < 0.051)) continue;
    const rows = await callOdoo('product.product', 'search_read', [[['name', 'ilike', `Empty ${kg}`]]], {
      fields: PRODUCT_FIELDS,
      limit: 20,
    });
    takeRows(rows);
  }
  return out;
};
