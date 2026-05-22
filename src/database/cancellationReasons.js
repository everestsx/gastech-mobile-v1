/**
 * Odoo cancellation reasons mirrored in SQLite for offline cancel modal.
 * Populated from sale.order.cancel.reason.wizard fields_get during sync/login.
 */
import { getDb } from './db.js';
import { empty, iso } from './dbHelpers.js';

export async function replaceCancellationReasons(reasons = []) {
  const list = (Array.isArray(reasons) ? reasons : [])
    .map((r, index) => ({
      value: String(r?.value ?? '').trim(),
      label: String(r?.label ?? r?.value ?? '').trim(),
      sort_order: index,
    }))
    .filter((r) => r.value);
  if (!list.length) return 0;

  const db = await getDb();
  const now = iso();
  await db.withTransactionAsync(async (tx) => {
    await tx.runAsync('DELETE FROM cancellation_reasons');
    for (const r of list) {
      await tx.runAsync(
        `INSERT INTO cancellation_reasons (value, label, sort_order, updated_at)
         VALUES (?, ?, ?, ?)`,
        [r.value, r.label, r.sort_order, now]
      );
    }
  });
  return list.length;
}

export async function getCancellationReasonsFromDb() {
  const db = await getDb();
  const rows = await db.getAllAsync(
    'SELECT value, label FROM cancellation_reasons ORDER BY sort_order ASC, value ASC'
  );
  return (rows || []).map((r) => ({
    value: String(r.value),
    label: String(r.label || r.value),
  }));
}

export async function getCancellationReasonsCount() {
  const db = await getDb();
  const row = await db.getFirstAsync('SELECT COUNT(*) AS c FROM cancellation_reasons');
  return Number(row?.c) || 0;
}

/** Label for a stored reason value (offline display / logs). */
export async function getCancellationReasonLabel(value) {
  const v = empty(value);
  if (!v) return '';
  const db = await getDb();
  const row = await db.getFirstAsync(
    'SELECT label FROM cancellation_reasons WHERE value = ? LIMIT 1',
    [v]
  );
  return row?.label ? String(row.label) : v;
}
