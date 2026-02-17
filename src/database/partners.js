/**
 * Local CRUD for partners (customers). Used for offline customer list.
 */
import { getDb } from './db.js';
import { empty, num, iso } from './dbHelpers.js';

/** String or null for optional TEXT; never pass object to SQLite. */
function strOrNull(v) {
  if (v == null || typeof v === 'object') return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

export async function upsertPartners(rows) {
  if (!rows?.length) return;
  const db = await getDb();
  await db.withTransactionAsync(async (tx) => {
    for (const r of rows) {
      await tx.runAsync(
        `INSERT OR REPLACE INTO partners (id, name, phone, city, updated_at) VALUES (?, ?, ?, ?, ?)`,
        [num(r.id), empty(r.name), strOrNull(r.phone),strOrNull(r.city), iso()]
      );
    }
  });
}

export async function getAllPartners() {
  const db = await getDb();
  const rows = await db.getAllAsync(
    `SELECT id, name, phone,city FROM partners ORDER BY name ASC`
  );
  return (rows || []).map((row) => ({
    id: row.id,
    name: row.name,
    phone: row.phone,
    city: row.city,
  }));
}
