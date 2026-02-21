/**
 * Application-wide formatting utilities.
 * Use formatAmount for comma-separated number only; use formatCurrency for amount with prefix (e.g. LKR / Rs.).
 */

/**
 * Format amount with 3-digit comma separation (e.g. 12345.67 → "12,345.67").
 * Use when you need only the number string; pair with your own prefix (Rs., LKR, etc.) if needed.
 * @param {number|string} value - Amount to format
 * @returns {string} Formatted string with 2 decimal places and thousands comma
 */
export function formatAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0.00';
  const parts = n.toFixed(2).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return parts.join('.');
}

/**
 * Format amount as currency with optional prefix (comma-separated).
 * @param {number|string} amount - Amount to format
 * @param {string} [prefix='LKR'] - Currency prefix (e.g. 'LKR', 'Rs.')
 * @returns {string} e.g. "LKR 12,345.67" or "Rs. 12,345.67"
 */
export function formatCurrency(amount, prefix = 'LKR') {
  return `${prefix} ${formatAmount(amount)}`;
}
