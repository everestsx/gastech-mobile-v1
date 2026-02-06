/**
 * Shared null-safe helpers for all DB writes. Use so NOT NULL columns never receive null.
 */

/** TEXT: never null — returns v or ''. */
export function empty(v) {
  return v != null && v !== '' ? String(v) : '';
}

/** Number: never null — returns number or 0. */
export function num(v) {
  return v != null && !Number.isNaN(Number(v)) ? Number(v) : 0;
}

/** Optional number: returns number or null. */
export function numOrNull(v) {
  return v != null && !Number.isNaN(Number(v)) ? Number(v) : null;
}

/** ISO date string: never null — returns v or now. */
export function iso(v) {
  return v != null && v !== '' ? String(v) : new Date().toISOString();
}

/** JSON array string: never null — returns JSON string or '[]'. */
export function jsonArr(v) {
  if (v == null) return '[]';
  return Array.isArray(v) ? JSON.stringify(v) : (typeof v === 'string' ? v : '[]');
}
