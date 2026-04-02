import { callOdoo } from './index.service';

/**
 * Get lorry/vehicle inventory (stock.quant) for a given stock location.
 * Uses backend stock rows directly (no hardcoded product codes) so renamed products are included.
 * @param {number} locationId - stock.location id (e.g. 94 for 7041/Stock)
 * @returns {Promise<Array>} [{ id, product_id, quantity, available_quantity }]
 */
export async function getVehicleInventoryByLocation(locationId) {
  if (locationId == null) return [];
  const response = await callOdoo(
    'stock.quant',
    'search_read',
    [
      [
        ['location_id', '=', locationId],
        ['product_id', '!=', false],
      ],
    ],
    { fields: ['product_id', 'quantity', 'available_quantity'] }
  );
  const rows = Array.isArray(response) ? response : [];
  const withStock = rows.filter((r) => {
    const quantity = Number(r?.quantity) || 0;
    const available = Number(r?.available_quantity) || 0;
    return quantity > 0 || available > 0;
  });
  console.log('[Vehicle Inventory API] locationId:', locationId, 'rows:', rows.length, 'withStock:', withStock.length);
  return withStock;
}
