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
  const normalized = rows.map((r) => ({
    ...r,
    quantity: Math.max(0, Number(r?.quantity) || 0),
    available_quantity: Math.max(0, Number(r?.available_quantity) || 0),
  }));
  console.log('[Vehicle Inventory API] locationId:', locationId, 'rows:', normalized.length);
  return normalized;
}
