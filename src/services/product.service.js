/**
 * Fetch products from Odoo product.product (including image_1920).
 * Used to display product names and product images on sale order cards/details.
 */
import { callOdoo } from './index.service';

const PRODUCT_FIELDS = ['id', 'name', 'list_price', 'qty_available', 'type', 'image_1920'];
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
 */
export const getMandatoryEmptyCylinderProducts = async (kgSizes = [2.4, 5, 12.5, 37.5]) => {
  const out = [];
  const seen = new Set();
  for (const kg of kgSizes || []) {
    const rows = await callOdoo('product.product', 'search_read', [[['name', 'ilike', `Empty ${kg}`]]], {
      fields: PRODUCT_FIELDS,
      limit: 20,
    });
    for (const r of rows || []) {
      const id = Number(r?.id);
      if (!Number.isFinite(id) || seen.has(id)) continue;
      seen.add(id);
      out.push(r);
    }
  }
  return out;
};
