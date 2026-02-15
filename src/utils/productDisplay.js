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
