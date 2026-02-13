import { callOdoo } from './index.service';

/** Gas product default codes we care about for vehicle stock. */
export const GAS_PRODUCT_CODES = ['GAS2.3', 'GAS5', 'GAS12.5', 'GAS37.5'];

/**
 * Get lorry/vehicle inventory (stock.quant) for a given stock location.
 * Filters by gas product default codes.
 * @param {number} locationId - stock.location id (e.g. 94 for 7041/Stock)
 * @returns {Promise<Array>} [{ id, product_id, quantity, available_quantity }]
 */
export async function getVehicleInventoryByLocation(locationId) {
  if (locationId == null) return [];
  return callOdoo(
    'stock.quant',
    'search_read',
    [
      [
        ['location_id', '=', locationId],
        ['product_id.default_code', 'in', GAS_PRODUCT_CODES],
      ],
    ],
    { fields: ['product_id', 'quantity', 'available_quantity'] }
  );
}
