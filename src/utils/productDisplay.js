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

/** Gas cylinder size categories for quick identification in order cards. */
export const GAS_SIZE_KG = {
  SMALL: 2.3,
  MEDIUM: 5,
  LARGE: 12.5,
  BIG: 37.5,
};

const SIZE_MAP = [
  { kg: 37.5, size: 'big', shortLabel: 'B', label: 'Big' },
  { kg: 12.5, size: 'large', shortLabel: 'L', label: 'Large' },
  { kg: 5, size: 'medium', shortLabel: 'M', label: 'Medium' },
  { kg: 2.3, size: 'small', shortLabel: 'S', label: 'Small' },
];

const WEIGHT_REGEX = /(2\.3|5|12\.5|37\.5)/i;

/**
 * Parse product name for weight (kg) and return size category for quick scanning.
 * Prefers the name between square brackets (e.g. "[GAS12.5] Gas 12.5 kg" → use "GAS12.5" to get 12.5 kg).
 * @param {string} raw - Raw product name (e.g. "[GAS12.5] Gas 12.5 kg")
 * @returns {{ size: string, shortLabel: string, label: string, kg: number } | null}
 */
export function getGasSizeFromProductName(raw) {
  if (raw == null || typeof raw !== 'string') return null;
  const str = raw.trim();
  const bracketMatch = str.match(/\[([^\]]+)\]/);
  const toSearch = bracketMatch ? bracketMatch[1] : str;
  const numMatch = toSearch.match(WEIGHT_REGEX);
  if (!numMatch) return null;
  const kg = parseFloat(numMatch[1]);
  const found = SIZE_MAP.find((s) => Math.abs(s.kg - kg) < 0.01);
  return found ? { ...found, kg } : null;
}
