/**
 * Show only the product/gas name in order cards (e.g. "12.5 kg", "GAS 37.5 KG").
 * Strips optional [CODE] prefix from Odoo (e.g. "[GAS12.5] 12.5 kg" → "12.5 kg").
 * @param {string} raw - Raw product name or " [CODE] name"
 * @returns {string}
 */
export function getProductDisplayName(raw) {
  if (raw == null || typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  const withoutCode = trimmed.replace(/^\[[^\]]+\]\s*/i, '').trim();
  return withoutCode || trimmed;
}

/**
 * Label for a sale order line from whatever the backend / local DB provides (no fixed product list).
 * Prefers product display name, then line description / display_name.
 * @param {Record<string, unknown>} line
 * @returns {string}
 */
export function getOrderLineDisplayLabel(line) {
  if (!line || typeof line !== 'object') return '';
  const p = line.product_id;
  if (Array.isArray(p) && p[1] != null && String(p[1]).trim()) return String(p[1]).trim();
  if (p && typeof p === 'object' && p.name != null && String(p.name).trim()) return String(p.name).trim();
  if (line.display_name != null && String(line.display_name).trim()) return String(line.display_name).trim();
  if (line.name != null && String(line.name).trim()) return String(line.name).trim();
  return '';
}

/**
 * Lines to show on an order card: explicit prop, merged orderLines, or full line objects on order.order_line.
 * Odoo often stores order_line as numeric ids only — those cannot be rendered until sale_order_lines are loaded (e.g. from DB).
 * @param {Record<string, unknown>} order
 * @param {unknown[]} [linesProp]
 * @returns {Record<string, unknown>[]}
 */
export function resolveOrderLinesForCard(order, linesProp) {
  if (Array.isArray(linesProp) && linesProp.length > 0) return linesProp;
  if (Array.isArray(order?.orderLines) && order.orderLines.length > 0) return order.orderLines;
  const ol = order?.order_line;
  if (!Array.isArray(ol) || ol.length === 0) return [];
  const first = ol[0];
  if (
    first != null &&
    typeof first === 'object' &&
    !Array.isArray(first) &&
    (first.product_id != null || (first.name != null && String(first.name).trim() !== ''))
  ) {
    return ol;
  }
  return [];
}

/** Sensible cylinder weights from backend names (not an exhaustive product catalog). */
const MIN_KG = 0.5;
const MAX_KG = 80;

/**
 * Parse cylinder weight in kg from the product name returned by the backend.
 * Matches any "… N kg" / "… N KG" (e.g. Gas 2.4 kg, NEW GAS 12.5 kg Cylinder).
 * If none, uses the first [BRACKET] segment (e.g. [GAS12.5] → 12.5).
 * @param {string} raw
 * @returns {number|null}
 */
export function parseKgFromProductName(raw) {
  if (raw == null || typeof raw !== 'string') return null;
  const str = raw.trim();
  if (!str) return null;

  const fromKg = [];
  const reKg = /(\d+(?:\.\d+)?)\s*kg\b/gi;
  let m;
  while ((m = reKg.exec(str)) !== null) {
    const v = parseFloat(m[1]);
    if (Number.isFinite(v) && v >= MIN_KG && v <= MAX_KG) fromKg.push(v);
  }
  if (fromKg.length) {
    if (fromKg.length === 1) return fromKg[0];
    const plausible = fromKg.filter((k) => k >= 1 && k <= 50);
    if (plausible.length) return Math.max(...plausible);
    return fromKg[0];
  }

  const bracket = str.match(/\[([^\]]+)\]/);
  if (bracket) {
    const nums = bracket[1].match(/\d+(?:\.\d+)?/g);
    if (nums) {
      for (let i = nums.length - 1; i >= 0; i--) {
        const v = parseFloat(nums[i]);
        if (Number.isFinite(v) && v >= MIN_KG && v <= MAX_KG) return v;
      }
    }
  }

  return null;
}

/**
 * UI tier from parsed kg (weight bands). Not tied to a fixed list of Odoo product names.
 * @param {number} kg
 */
function getGasTierFromKg(kg) {
  if (kg < 4) return { size: 'small', shortLabel: 'S', label: 'Small' };
  if (kg < 9) return { size: 'medium', shortLabel: 'M', label: 'Medium' };
  if (kg < 20) return { size: 'large', shortLabel: 'L', label: 'Large' };
  return { size: 'big', shortLabel: 'B', label: 'Big' };
}

/**
 * Parse product name for weight (kg) and return size category for quick scanning.
 * Prefers explicit "N kg" in the name, then numbers inside [CODE] (e.g. [GAS12.5]).
 * @param {string} raw - Raw product name from backend
 * @returns {{ size: string, shortLabel: string, label: string, kg: number } | null}
 */
export function getGasSizeFromProductName(raw) {
  const kg = parseKgFromProductName(raw);
  if (kg == null) return null;
  return { ...getGasTierFromKg(kg), kg };
}

/**
 * Get the blue color shade for a gas type based on cylinder size (from parsed kg).
 * @param {string} raw - Raw product name (e.g. "Gas 12.5 kg").
 * @returns {string} - Blue hex color for the gas type.
 */
export function getGasTypeBlueColor(raw) {
  const gasSize = getGasSizeFromProductName(raw);
  if (!gasSize) return '#60a5fa';

  const blueShades = {
    small: '#93c5fd',
    medium: '#60a5fa',
    large: '#3b82f6',
    big: '#1d4ed8',
  };

  return blueShades[gasSize.size] || '#60a5fa';
}
