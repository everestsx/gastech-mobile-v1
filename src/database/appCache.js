/**
 * Small key-value cache in SQLite (e.g. Odoo cancellation reason list for offline use).
 */
import { getDb } from './db.js';
import { empty, iso } from './dbHelpers.js';

export const CACHE_KEY_CANCEL_REASONS = 'cancellation_reasons';
/** Supplier block for the invoice header (res.company + its partner address) — enables offline printing. */
export const CACHE_KEY_COMPANY_PARTY = 'company_party_info';

function safeParse(s) {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch (_) {
    return null;
  }
}

export async function getAppCache(key) {
  const k = empty(key);
  if (!k) return null;
  const db = await getDb();
  const row = await db.getFirstAsync(
    'SELECT value_json FROM app_cache WHERE cache_key = ? LIMIT 1',
    [k]
  );
  return safeParse(row?.value_json);
}

export async function setAppCache(key, value) {
  const k = empty(key);
  if (!k) return;
  const db = await getDb();
  const json = JSON.stringify(value ?? null);
  await db.runAsync(
    `INSERT INTO app_cache (cache_key, value_json, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(cache_key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
    [k, json, iso()]
  );
}
