import { parseKgFromProductName } from './productDisplay';

/** Canonical lorry cylinder sizes shown on Dashboard + My Stocks (matches typical Odoo GAS lines). */
export const DEFAULT_GAS_CYLINDER_KG_SIZES = [2.4, 5, 12.5, 37.5];

function kgMatchesCanonical(parsedKg, canonicalKg) {
  return Math.abs(parsedKg - canonicalKg) < 0.051;
}

/**
 * Map a product name to one of DEFAULT_GAS_CYLINDER_KG_SIZES, or null if not a listed size.
 * @param {string} rawName
 * @returns {number|null}
 */
export function canonicalGasKgFromProductName(rawName) {
  const p = parseKgFromProductName(String(rawName || ''));
  if (p == null) return null;
  for (const c of DEFAULT_GAS_CYLINDER_KG_SIZES) {
    if (kgMatchesCanonical(p, c)) return c;
  }
  return null;
}

/**
 * @template T
 * @param {T[]} rows
 * @param {(row: T) => string} getName
 * @returns {Map<number, T>}
 */
export function indexRowsByCanonicalGasKg(rows, getName) {
  const map = new Map();
  for (const row of rows || []) {
    const c = canonicalGasKgFromProductName(getName(row));
    if (c == null) continue;
    if (!map.has(c)) map.set(c, row);
  }
  return map;
}

function syntheticVehicleInventoryId(kg) {
  return -300000 - Math.round(kg * 100);
}

/**
 * Exactly four rows for My Stocks: merge local/API quants; missing sizes show 0 on-hand / 0 extra.
 * Non-canonical products are omitted.
 * @param {Array<Record<string, unknown>>} inventoryRows
 * @param {Record<number, string>} [productIdToName]
 * @returns {Array<Record<string, unknown>>}
 */
export function buildDefaultGasVehicleInventoryRows(inventoryRows, productIdToName = {}) {
  const first = Array.isArray(inventoryRows) && inventoryRows.length > 0 ? inventoryRows[0] : null;
  const fallbackLoc = first?.location_id ?? null;
  const fallbackVehicle = first?.vehicle_id ?? null;

  const getName = (row) => {
    const pid = row.product_id != null ? Number(row.product_id) : null;
    const fromMap = pid != null && Number.isFinite(pid) ? productIdToName[pid] : null;
    return String(fromMap || row.product_name || '');
  };

  const indexed = indexRowsByCanonicalGasKg(inventoryRows || [], getName);

  return DEFAULT_GAS_CYLINDER_KG_SIZES.map((kg) => {
    const existing = indexed.get(kg);
    if (existing) {
      return {
        ...existing,
        _defaultGasKg: kg,
        display_key: `default-gas-${kg}`,
      };
    }
    return {
      id: syntheticVehicleInventoryId(kg),
      location_id: fallbackLoc,
      vehicle_id: fallbackVehicle,
      product_id: null,
      product_name: `Gas ${kg} kg`,
      quantity: 0,
      available_quantity: 0,
      _defaultGasKg: kg,
      display_key: `default-gas-${kg}`,
    };
  });
}

/**
 * Exactly four dashboard stock cards: on-hand from inventory; delivered stays 0 when product_id is unknown.
 * @param {Array<{ product_id: number, product_name?: string, total: number, remaining?: number }>} rows — e.g. Object.values(byProduct)
 * @param {Record<number, string>} [productNameMap]
 * @returns {Array<Record<string, unknown>>}
 */
export function buildDefaultGasDashboardStockCards(rows, productNameMap = {}) {
  const getName = (row) => {
    const pid = row.product_id != null ? Number(row.product_id) : null;
    const fromMap = pid != null && Number.isFinite(pid) ? productNameMap[pid] : null;
    return String(fromMap || row.product_name || '');
  };

  const indexed = indexRowsByCanonicalGasKg(rows || [], getName);

  return DEFAULT_GAS_CYLINDER_KG_SIZES.map((kg) => {
    const existing = indexed.get(kg);
    if (existing) {
      return {
        product_id: existing.product_id,
        product_name: existing.product_name,
        total: Math.max(0, Number(existing.total) || 0),
        remaining: Math.max(0, Number(existing.remaining) || 0),
        _defaultGasKg: kg,
        display_key: `default-gas-${kg}`,
      };
    }
    return {
      product_id: null,
      product_name: `Gas ${kg} kg`,
      total: 0,
      remaining: 0,
      _defaultGasKg: kg,
      display_key: `default-gas-${kg}`,
    };
  });
}
