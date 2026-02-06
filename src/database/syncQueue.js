/**
 * Pending actions to push to Odoo on sync (delivery updates, payments, etc.).
 */
import { getDb } from './db.js';

export const ACTION_DELIVERY = 'delivery';
export const ACTION_PAYMENT = 'payment';

export async function enqueue(actionType, payload) {
  const db = await getDb();
  const now = new Date().toISOString();
  const result = await db.runAsync(
    'INSERT INTO sync_queue (action_type, payload, created_at) VALUES (?, ?, ?)',
    [actionType, JSON.stringify(payload), now]
  );
  return result.lastInsertRowId;
}

export async function getPending() {
  const db = await getDb();
  const rows = await db.getAllAsync(
    'SELECT id, action_type, payload, created_at FROM sync_queue WHERE synced_at IS NULL ORDER BY id ASC'
  );
  return (rows || []).map((row) => ({
    id: row.id,
    action_type: row.action_type,
    payload: safeParseJson(row.payload, {}),
    created_at: row.created_at,
  }));
}

export async function markSynced(id) {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.runAsync('UPDATE sync_queue SET synced_at = ? WHERE id = ?', [now, id]);
}

export async function getPendingCount() {
  const db = await getDb();
  const row = await db.getFirstAsync(
    'SELECT COUNT(*) as c FROM sync_queue WHERE synced_at IS NULL'
  );
  return row?.c ?? 0;
}

function safeParseJson(str, fallback) {
  if (str == null || str === '') return fallback;
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}
