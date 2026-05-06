import { callOdoo } from './index.service';

/**
 * Extract stock location search part from vehicle license plate.
 * Odoo uses complete_name like "7041/Stock" for vehicle LN-7041.
 */
export function getStockLocationSearchFromLicensePlate(licensePlate) {
  if (!licensePlate || typeof licensePlate !== 'string') return null;
  const trimmed = licensePlate.trim();
  const afterHyphen = trimmed.split('-').pop();
  const numberPart = (afterHyphen || trimmed).replace(/\D/g, '') || trimmed;
  return numberPart ? `${numberPart}/Stock` : null;
}

/**
 * Get lorry/vehicle stock location by vehicle license plate.
 * Calls stock.location search_read with complete_name ilike "{number}/Stock".
 * @param {string} licensePlate - e.g. "LN-7041"
 * @returns {Promise<Array>} [{ id, name, complete_name }]
 */
export async function getStockLocationByVehicle(licensePlate) {
  const searchPart = getStockLocationSearchFromLicensePlate(licensePlate);
  if (!searchPart) return [];
  return callOdoo(
    'stock.location',
    'search_read',
    [[['complete_name', 'ilike', searchPart]]],
    { fields: ['id', 'name', 'complete_name'] }
  );
}

/**
 * Get all stock warehouses with their lot stock location.
 * This is the most reliable source for vehicle -> stock location mapping.
 */
export async function getStockWarehouses() {
  return callOdoo(
    'stock.warehouse',
    'search_read',
    [[]],
    { fields: ['id', 'name', 'code', 'lot_stock_id', 'company_id'], order: 'id asc' }
  );
}
