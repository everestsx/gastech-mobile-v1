/**
 * Shared null-safe helpers for all DB writes.
 * Never pass objects to SQLite — the native bridge (Kotlin) cannot convert them.
 */

/** TEXT: never null, never object — returns string or ''. */
export function empty(v) {
  if (v == null || v === '' || typeof v === 'object') return '';
  return String(v);
}

/** Number: never null — returns number or 0. Never pass object. */
export function num(v) {
  if (v == null || typeof v === 'object') return 0;
  const n = Number(v);
  return !Number.isNaN(n) ? n : 0;
}

/** Optional number: returns number or null. Never pass object. */
export function numOrNull(v) {
  if (v == null || typeof v === 'object') return null;
  const n = Number(v);
  return !Number.isNaN(n) ? n : null;
}

/** ISO date string: never null. Never pass object (would become "[object Object]"). */
export function iso(v) {
  if (v == null || v === '' || typeof v === 'object') return new Date().toISOString();
  return String(v);
}

/** JSON array string: never null — returns JSON string or '[]'. */
export function jsonArr(v) {
  if (v == null) return '[]';
  if (typeof v === 'object') return Array.isArray(v) ? JSON.stringify(v) : '[]';
  return typeof v === 'string' ? v : '[]';
}

/**
 * Odoo Many2one / x2m payloads: [id, name] or plain id. Returns numeric ids only (e.g. stock.picking.move_ids).
 */
export function normalizeOdooRelationIds(v) {
  if (v == null) return [];
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const item of v) {
    if (Array.isArray(item) && item.length > 0) {
      const n = Number(item[0]);
      if (Number.isFinite(n) && n > 0) out.push(n);
    } else {
      const n = Number(item);
      if (Number.isFinite(n) && n > 0) out.push(n);
    }
  }
  return out;
}
