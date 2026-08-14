import { parseKgFromProductName } from './productDisplay';

const CANONICAL_KG = [2.4, 5, 12.5, 37.5];

export function canonicalKg(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  for (const c of CANONICAL_KG) {
    if (Math.abs(n - c) < 0.051) return c;
  }
  return null;
}

function normalize(raw) {
  return String(raw || '').toLowerCase().trim();
}

export function isEmptyCylinderName(raw) {
  const s = normalize(raw);
  if (!s.includes('empty')) return false;
  return s.includes('cylinder') || s.includes('cyl') || s.includes('bottle');
}

export function isNewIssueName(raw) {
  return normalize(raw).includes('new issue');
}

export function isGasCylinderName(raw) {
  const s = normalize(raw);
  if (!s) return false;
  if (isEmptyCylinderName(s) || isNewIssueName(s)) return false;
  return s.includes('gas') && parseKgFromProductName(s) != null;
}

export function canonicalKgFromName(raw) {
  const parsed = parseKgFromProductName(String(raw || ''));
  if (parsed == null) return null;
  return canonicalKg(parsed);
}

export function labelFromKg(kg) {
  return `${kg} kg`;
}

/**
 * Resolve empty-cylinder product id for a canonical kg from a product id → name map (e.g. products table / Odoo catalog).
 * Used when vehicle stock has no quant row yet for empties but the product exists in the catalog.
 * @param {Record<number, string>} productIdToName
 * @param {number} kg
 * @returns {number | null}
 */
export function findEmptyCylinderProductIdForKg(productIdToName, kg) {
  const target = canonicalKg(kg);
  if (target == null) return null;
  const entries = productIdToName && typeof productIdToName === 'object' ? Object.entries(productIdToName) : [];
  for (const [pidStr, rawName] of entries) {
    const pid = Number(pidStr);
    if (!Number.isFinite(pid)) continue;
    if (!isEmptyCylinderName(rawName)) continue;
    const c = canonicalKgFromName(rawName);
    if (c != null && Math.abs(c - target) < 0.051) return pid;
  }
  return null;
}

/**
 * Resolve empty-cylinder product id from vehicle inventory rows first, then the products catalog.
 * Prefers the inventory product_name when it looks like an empty cylinder so a blank/stale
 * products.name cannot hide a valid quant mapping.
 */
export function resolveEmptyCylinderProductId(productIdToName, inventoryRows, kg) {
  const target = canonicalKg(kg);
  if (target == null) return null;
  for (const row of inventoryRows || []) {
    const pid = row?.product_id != null ? Number(row.product_id) : null;
    if (!Number.isFinite(pid)) continue;
    const fromMap =
      (productIdToName && (productIdToName[pid] || productIdToName[String(pid)])) || '';
    const fromInv = row?.product_name || '';
    const name = isEmptyCylinderName(fromInv) ? fromInv : fromMap || fromInv;
    if (!isEmptyCylinderName(name)) continue;
    const c = canonicalKgFromName(name);
    if (c != null && Math.abs(c - target) < 0.051) return pid;
  }
  return findEmptyCylinderProductIdForKg(productIdToName, target);
}
