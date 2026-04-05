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

/**
 * Integer primary key from an Odoo record (never pass arrays/objects through to num() blindly).
 */
export function odooRecordId(v) {
  if (v == null || v === false) return 0;
  if (Array.isArray(v) && v.length > 0) return num(v[0]);
  if (typeof v === 'object') return 0;
  return num(v);
}

/**
 * Odoo char/text (and custom translated fields) for SQLite binds on Android: never return a plain object.
 * Handles false, translation maps { lang: text }, accidental many2one-shaped [id, display_name].
 * @param {unknown} v
 * @param {number} [depth] guard nested / cyclic structures
 */
export function odooTextOrNull(v, depth = 0) {
  if (depth > 10) return null;
  if (v == null || v === false) return null;
  const t = typeof v;
  if (t === 'string' || t === 'number' || t === 'bigint') {
    const s = String(v).trim();
    if (s === '' || s.toLowerCase() === 'false') return null;
    return s;
  }
  if (t === 'boolean') {
    return v ? 'true' : null;
  }
  if (t !== 'object') return null;
  if (Array.isArray(v)) {
    if (v.length >= 2 && v[1] != null && typeof v[1] !== 'object') {
      const s = String(v[1]).trim();
      if (s === '' || s.toLowerCase() === 'false') return null;
      return s;
    }
    if (v.length >= 1 && v[0] != null && typeof v[0] !== 'object') {
      const s = String(v[0]).trim();
      if (s === '' || s.toLowerCase() === 'false') return null;
      return s;
    }
    return null;
  }
  for (const key of ['value', 'name', 'display_name']) {
    if (v[key] != null) {
      const inner = odooTextOrNull(v[key], depth + 1);
      if (inner) return inner;
    }
  }
  for (const x of Object.values(v)) {
    if (x != null && typeof x !== 'object') {
      const s = String(x).trim();
      if (s !== '' && s.toLowerCase() !== 'false') return s;
    }
  }
  for (const x of Object.values(v)) {
    if (x != null && typeof x === 'object') {
      const inner = odooTextOrNull(x, depth + 1);
      if (inner) return inner;
    }
  }
  return null;
}

/** NOT NULL TEXT columns: always a string (Kotlin-safe). */
export function odooTextRequired(v) {
  return odooTextOrNull(v) ?? '';
}

/**
 * expo-sqlite Android: bind map must convert cleanly to Kotlin Map<String, Any>.
 * Avoid null/undefined/object/boolean edge cases — use string or number only.
 * @param {unknown[]} params
 * @returns {(string|number)[]}
 */
/**
 * Normalize every `runAsync` bind for expo-sqlite on Android (Kotlin).
 * The native bridge rejects JS `null`, `undefined`, and plain objects — use only string, number, or blob views.
 * Empty string replaces former null/unknown (SQLite INTEGER affinity usually stores NULL for '').
 */
export function sanitizeSqliteBindParams(params) {
  if (!Array.isArray(params)) return params;
  return params.map((v) => {
    if (v === undefined || v === null) return '';
    if (typeof Uint8Array !== 'undefined' && v instanceof Uint8Array) return v;
    if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView && ArrayBuffer.isView(v)) return v;
    const t = typeof v;
    if (t === 'string') return v;
    if (t === 'number') return Number.isFinite(v) ? v : 0;
    if (t === 'bigint') {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    }
    if (t === 'boolean') return v ? 1 : 0;
    if (v instanceof Date) return v.toISOString();
    if (Array.isArray(v)) {
      let x = v;
      while (Array.isArray(x) && x.length > 0) {
        const el = x[0];
        if (Array.isArray(el)) {
          x = el;
          continue;
        }
        const n = Number(el);
        return Number.isFinite(n) ? n : '';
      }
      return '';
    }
    if (t === 'object') return '';
    try {
      const s = String(v);
      return s === '[object Object]' ? '' : s;
    } catch {
      return '';
    }
  });
}

/**
 * expo-sqlite `runAsync` / `getAllAsync` accept either `sql, [a,b]` or `sql, a, b`.
 * Always produce one sanitized array for the `sql, [...]` form so binds are never a stray object.
 */
export function coerceSqliteStatementBindings(restArgs) {
  if (!restArgs || restArgs.length === 0) return [];
  if (restArgs.length === 1 && Array.isArray(restArgs[0])) {
    return sanitizeSqliteBindParams(restArgs[0]);
  }
  return sanitizeSqliteBindParams(restArgs);
}

export function coerceSqliteBindArray(params) {
  return (params || []).map((v, index) => {
    if (v === undefined || v === null) {
      return index === 0 ? 0 : '';
    }
    const t = typeof v;
    if (t === 'object') {
      return index === 0 ? 0 : '';
    }
    if (t === 'boolean') {
      return v ? 1 : 0;
    }
    if (t === 'number') {
      if (!Number.isFinite(v)) return index === 0 ? 0 : '';
      return v;
    }
    if (t === 'bigint') {
      const n = Number(v);
      return Number.isFinite(n) ? n : index === 0 ? 0 : '';
    }
    if (t === 'string') {
      return v;
    }
    const s = String(v);
    if (s === '[object Object]') return index === 0 ? 0 : '';
    return s;
  });
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
 * Optional INTEGER FK for expo-sqlite on Android (Kotlin bridge rejects objects).
 * Unwraps Odoo many2one [id, name]. Invalid values → SQL NULL (do not bind "" for INTEGER).
 */
export function sqliteIntegerFkOrNull(v) {
  if (v == null || v === false || v === '') return null;
  if (Array.isArray(v)) {
    const n = v.length > 0 ? Number(v[0]) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  if (typeof v === 'object') return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
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
