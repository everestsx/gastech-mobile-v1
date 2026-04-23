import { parseKgFromProductName } from './productDisplay';
import { isEmptyCylinderName } from './cylinderCatalog';

/** Canonical lorry cylinder sizes shown on Dashboard + My Stocks (matches typical Odoo GAS lines). */
export const DEFAULT_GAS_CYLINDER_KG_SIZES = [2.4, 5, 12.5, 37.5];

function kgMatchesCanonical(parsedKg, canonicalKg) {
  return Math.abs(parsedKg - canonicalKg) < 0.051;
}

function normalizeName(raw) {
  return String(raw || '').toLowerCase().trim();
}

function looksLikeEmptyCylinder(rawName) {
  return /\bempty\b/.test(normalizeName(rawName));
}

function looksLikeGasCylinder(rawName) {
  const normalized = normalizeName(rawName);
  if (!normalized) return false;
  if (looksLikeEmptyCylinder(normalized)) return false;
  return /\bgas\b/.test(normalized);
}

function scoreCanonicalRowForDisplay(rowName, row) {
  const isGas = looksLikeGasCylinder(rowName);
  const isEmpty = looksLikeEmptyCylinder(rowName);
  const hasProductId = row?.product_id != null;
  if (isGas) return 4;
  if (!isEmpty && hasProductId) return 3;
  if (!isEmpty) return 2;
  if (hasProductId) return 1;
  return 0;
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
    const rowName = getName(row);
    if (isEmptyCylinderName(rowName)) continue;
    const c = canonicalGasKgFromProductName(rowName);
    if (c == null) continue;
    if (!map.has(c)) {
      map.set(c, row);
      continue;
    }
    const existing = map.get(c);
    const existingScore = scoreCanonicalRowForDisplay(getName(existing), existing);
    const candidateScore = scoreCanonicalRowForDisplay(rowName, row);
    if (candidateScore > existingScore) map.set(c, row);
  }
  return map;
}

function syntheticVehicleInventoryId(kg) {
  return -300000 - Math.round(kg * 100);
}

/**
 * My Stocks: four default gas sizes (0 when missing) plus any other stocked products
 * (non-gas, non–empty-cylinder) with positive on-hand or extra. Empty-cylinder lines are excluded.
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

  const defaultRows = DEFAULT_GAS_CYLINDER_KG_SIZES.map((kg) => {
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

  return appendNonGasStockedVehicleRows(defaultRows, inventoryRows || [], getName);
}

/**
 * @param {Array<Record<string, unknown>>} defaultRows
 * @param {Array<Record<string, unknown>>} inventoryRows
 * @param {(row: Record<string, unknown>) => string} getName
 */
function appendNonGasStockedVehicleRows(defaultRows, inventoryRows, getName) {
  const usedProductIds = new Set();
  for (const r of defaultRows) {
    if (r?.product_id != null) usedProductIds.add(Number(r.product_id));
  }
  const extras = [];
  const seen = new Set();
  for (const row of inventoryRows) {
    const name = getName(row);
    if (isEmptyCylinderName(name)) continue;
    if (canonicalGasKgFromProductName(name) != null) continue;
    const pid = row?.product_id != null ? Number(row.product_id) : null;
    if (pid == null || !Number.isFinite(pid)) continue;
    if (usedProductIds.has(pid)) continue;
    const onHand = Math.max(0, Number(row.quantity) || 0);
    const extraQ = Math.max(0, Number(row.available_quantity ?? row.extra_quantity ?? 0) || 0);
    if (onHand <= 0 && extraQ <= 0) continue;
    if (seen.has(pid)) continue;
    seen.add(pid);
    extras.push({
      ...row,
      _defaultGasKg: undefined,
      _isExtraProduct: true,
      display_key: `extra-stock-${pid}`,
    });
  }
  extras.sort((a, b) => getName(a).localeCompare(getName(b), 'en'));
  return [...defaultRows, ...extras];
}

/**
 * Dashboard stock strip: four default gas cards (0 when missing) plus other products with
 * positive on-hand or remaining. Empty-cylinder products are excluded.
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

  const defaultCards = DEFAULT_GAS_CYLINDER_KG_SIZES.map((kg) => {
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

  return appendNonGasStockedDashboardCards(defaultCards, rows || [], getName);
}

/**
 * @param {Array<Record<string, unknown>>} defaultCards
 * @param {Array<Record<string, unknown>>} rows
 * @param {(row: Record<string, unknown>) => string} getName
 */
function appendNonGasStockedDashboardCards(defaultCards, rows, getName) {
  const usedProductIds = new Set();
  for (const c of defaultCards) {
    if (c?.product_id != null) usedProductIds.add(Number(c.product_id));
  }
  const extras = [];
  const seen = new Set();
  for (const row of rows) {
    const name = getName(row);
    if (isEmptyCylinderName(name)) continue;
    if (canonicalGasKgFromProductName(name) != null) continue;
    const pid = row?.product_id != null ? Number(row.product_id) : null;
    if (pid == null || !Number.isFinite(pid)) continue;
    if (usedProductIds.has(pid)) continue;
    const total = Math.max(0, Number(row.total) || 0);
    const rem = Math.max(0, Number(row.remaining) || 0);
    if (total <= 0 && rem <= 0) continue;
    if (seen.has(pid)) continue;
    seen.add(pid);
    usedProductIds.add(pid);
    extras.push({
      product_id: row.product_id,
      product_name: row.product_name,
      total,
      remaining: rem,
      _defaultGasKg: undefined,
      _isExtraProduct: true,
      display_key: `extra-dashboard-${pid}`,
    });
  }
  extras.sort((a, b) => getName({ product_name: a.product_name, product_id: a.product_id }).localeCompare(
    getName({ product_name: b.product_name, product_id: b.product_id }),
    'en'
  ));
  return [...defaultCards, ...extras];
}
