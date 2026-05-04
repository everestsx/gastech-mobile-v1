import { callOdoo } from './index.service';
import { deriveWarehouseDigitRunsFromPlate } from '../utils/vehiclePlateStock';

/**
 * Extract preferred stock.complete_name substring from licence plate (first candidate).
 */
export function getStockLocationSearchFromLicensePlate(licensePlate) {
  const runs = deriveWarehouseDigitRunsFromPlate(licensePlate);
  return runs.length > 0 ? `${runs[0]}/Stock` : null;
}

function preferBestLocationRow(rows, preferredSuffixLower) {
  const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
  if (list.length <= 1) return list;
  const want = preferredSuffixLower || '';
  return [...list].sort((a, b) => {
    const na = String(a.complete_name || a.name || '').toLowerCase();
    const nb = String(b.complete_name || b.name || '').toLowerCase();
    /** Exact ".../0417/stock" end wins */
    const endA = want && na.endsWith(want.toLowerCase()) ? 0 : 1;
    const endB = want && nb.endsWith(want.toLowerCase()) ? 0 : 1;
    if (endA !== endB) return endA - endB;
    /** Shallower paths (fewer slashes) preferred */
    const depth = (s) => (s.match(/\//g) || []).length;
    return depth(na) - depth(nb);
  });
}

/**
 * Get lorry stock location(s) by plate. Tries exact `{code}/Stock` per digit run, then ilike fallback.
 */
export async function getStockLocationByVehicle(licensePlate) {
  const digits = deriveWarehouseDigitRunsFromPlate(licensePlate);
  if (!digits.length) return [];

  const fields = ['id', 'name', 'complete_name'];
  for (const num of digits) {
    const exact = `${num}/Stock`;
    try {
      const exactRows = await callOdoo(
        'stock.location',
        'search_read',
        [[['complete_name', '=', exact]]],
        { fields, limit: 8 }
      );
      if (Array.isArray(exactRows) && exactRows.length > 0) {
        const ranked = preferBestLocationRow(exactRows, `${num}/stock`);
        return ranked;
      }
    } catch (_) {
      /* strict match unavailable in some deployments — fall through */
    }
  }

  const searchSuffix = digits[0] ? `${digits[0]}/Stock` : null;
  if (!searchSuffix) return [];
  const fuzzy = await callOdoo(
    'stock.location',
    'search_read',
    [[['complete_name', 'ilike', searchSuffix]]],
    { fields, limit: 20 }
  );
  return preferBestLocationRow(fuzzy, `${digits[0]}/stock`).slice(0, 8);
}
