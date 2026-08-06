import { callOdoo } from './index.service';

/**
 * Plate digit variants for warehouse / stock.location matching.
 * Odoo often stores locations as "309/Stock" while fleet plates are "LN-0309".
 * @param {string} licensePlate
 * @returns {string[]} e.g. ["0309", "309"]
 */
export function getVehiclePlateNumberVariants(licensePlate) {
  if (licensePlate == null) return [];
  const trimmed = String(licensePlate).trim();
  if (!trimmed) return [];
  const afterHyphen = trimmed.split('-').pop() || trimmed;
  const rawDigits = String(afterHyphen).replace(/\D/g, '') || String(trimmed).replace(/\D/g, '');
  if (!rawDigits) return [];
  const stripped = rawDigits.replace(/^0+/, '') || rawDigits;
  const variants = [];
  const add = (v) => {
    if (v && !variants.includes(v)) variants.push(v);
  };
  add(rawDigits);
  add(stripped);
  return variants;
}

/**
 * Extract stock location search part from vehicle license plate.
 * Odoo uses complete_name like "7041/Stock" for vehicle LN-7041.
 */
export function getStockLocationSearchFromLicensePlate(licensePlate) {
  const variants = getVehiclePlateNumberVariants(licensePlate);
  if (!variants.length) return null;
  return `${variants[0]}/Stock`;
}

/**
 * Score a stock.location candidate against plate digit variants.
 * Rejects substring false-positives (e.g. "309/Stock" must not win via "1309/Stock").
 */
export function scoreStockLocationForPlate(location, plateNumberVariants) {
  const variants = (plateNumberVariants || []).map(String).filter(Boolean);
  if (!variants.length) return -1;
  const complete = String(location?.complete_name || '').trim();
  const name = String(location?.name || '').trim();
  if (!complete && !name) return -1;

  let best = -1;
  for (const n of variants) {
    const exactComplete = `${n}/Stock`;
    if (complete.toLowerCase() === exactComplete.toLowerCase()) {
      best = Math.max(best, 100);
      continue;
    }
    // ".../309/Stock" or "WH/309/Stock"
    const endRe = new RegExp(`(?:^|/)${n}/Stock$`, 'i');
    if (endRe.test(complete)) {
      best = Math.max(best, 90);
      continue;
    }
    if (/^stock$/i.test(name) && new RegExp(`(?:^|/)${n}$`, 'i').test(complete.replace(/\/Stock$/i, ''))) {
      best = Math.max(best, 80);
      continue;
    }
  }
  return best;
}

function pickBestStockLocation(locations, plateNumberVariants) {
  let best = null;
  let bestScore = -1;
  for (const loc of locations || []) {
    const score = scoreStockLocationForPlate(loc, plateNumberVariants);
    if (score > bestScore) {
      bestScore = score;
      best = loc;
    }
  }
  return bestScore >= 80 ? best : null;
}

/**
 * Get lorry/vehicle stock location by vehicle license plate.
 * Tries padded and unpadded plate numbers; picks the best exact-ish match
 * (avoids ilike false positives like 309 matching 1309).
 * @param {string} licensePlate - e.g. "LN-7041" or "LN-0309"
 * @returns {Promise<Array>} [{ id, name, complete_name }] — best match first, or []
 */
export async function getStockLocationByVehicle(licensePlate) {
  const variants = getVehiclePlateNumberVariants(licensePlate);
  if (!variants.length) return [];

  const fields = { fields: ['id', 'name', 'complete_name'], limit: 40 };
  const searchParts = variants.map((n) => `${n}/Stock`);

  // One OR domain covering equality for all plate digit variants (padded + unpadded).
  const equalLeaves = searchParts.map((p) => ['complete_name', '=', p]);
  const ilikeLeaves = searchParts.map((p) => ['complete_name', 'ilike', p]);
  // Odoo OR syntax: ['|', A, B] or ['|', C, '|', A, B]
  const orDomain = (leaves) => {
    if (!leaves.length) return [];
    if (leaves.length === 1) return leaves;
    let domain = [leaves[0]];
    for (let i = 1; i < leaves.length; i += 1) {
      domain = ['|', leaves[i], ...domain];
    }
    return domain;
  };

  const collected = [];
  const seenIds = new Set();
  const absorb = (rows) => {
    for (const row of rows || []) {
      const id = row?.id != null ? Number(row.id) : null;
      if (id == null || seenIds.has(id)) continue;
      seenIds.add(id);
      collected.push(row);
    }
  };

  try {
    const exactRows = await callOdoo('stock.location', 'search_read', [orDomain(equalLeaves)], fields);
    absorb(exactRows);
    const bestExact = pickBestStockLocation(collected, variants);
    if (bestExact) return [bestExact];
  } catch (_) {
    /* fall through to ilike */
  }

  try {
    const ilikeRows = await callOdoo('stock.location', 'search_read', [orDomain(ilikeLeaves)], fields);
    absorb(ilikeRows);
  } catch (_) {
    /* no locations */
  }

  const best = pickBestStockLocation(collected, variants);
  return best ? [best] : [];
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
