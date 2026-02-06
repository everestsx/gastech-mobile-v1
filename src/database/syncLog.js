/**
 * Sync history for dashboard (last sync time, status, counts, errors).
 */
import { getDb } from './db.js';
import { empty, iso } from './dbHelpers.js';

export async function appendLog({ sync_at, status, message, counts }) {
  const db = await getDb();
  const now = iso();
  const countsStr = counts != null ? JSON.stringify(counts) : null;
  await db.runAsync(
    'INSERT INTO sync_log (sync_at, status, message, counts, created_at) VALUES (?, ?, ?, ?, ?)',
    [sync_at != null && sync_at !== '' ? sync_at : now, empty(status) || 'success', message != null && message !== '' ? message : null, countsStr, now]
  );
}

export async function getRecent(limit = 20) {
  const db = await getDb();
  const rows = await db.getAllAsync(
    'SELECT id, sync_at, status, message, counts, created_at FROM sync_log ORDER BY id DESC LIMIT ?',
    [limit]
  );
  return (rows || []).map((row) => ({
    id: row.id,
    sync_at: row.sync_at,
    status: row.status,
    message: row.message,
    counts: row.counts ? safeParseJson(row.counts, null) : null,
    created_at: row.created_at,
  }));
}

export async function getLastSyncTime() {
  const db = await getDb();
  const row = await db.getFirstAsync(
    "SELECT sync_at FROM sync_log WHERE status = 'success' ORDER BY id DESC LIMIT 1"
  );
  return row?.sync_at ?? null;
}

function safeParseJson(str, fallback) {
  if (str == null || str === '') return fallback;
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}
