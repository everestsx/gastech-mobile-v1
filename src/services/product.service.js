/**
 * Fetch products from Odoo product.product (id, name, list_price, qty_available).
 * Used to display product names on sale order cards and details.
 */
import { callOdoo } from './index.service';

const PRODUCT_FIELDS = ['id', 'name', 'list_price', 'qty_available'];
const PRODUCT_LIMIT = 500;

/**
 * Get all products from product.product (search_read).
 * @returns {Promise<Array<{ id: number, name: string, list_price?: number, qty_available?: number }>>}
 */
export const getAllProducts = () =>
  callOdoo('product.product', 'search_read', [[]], {
    fields: PRODUCT_FIELDS,
    limit: PRODUCT_LIMIT,
  });

/**
 * Get products by ids (for vehicle-scoped sync; avoids fetching all products).
 * @param {number[]} ids
 * @returns {Promise<Array<{ id: number, name: string, list_price?: number, qty_available?: number }>>}
 */
export const getProductsByIds = (ids) => {
  if (!ids?.length) return Promise.resolve([]);
  return callOdoo('product.product', 'search_read', [[['id', 'in', ids]]], {
    fields: PRODUCT_FIELDS,
    limit: ids.length,
  });
};
