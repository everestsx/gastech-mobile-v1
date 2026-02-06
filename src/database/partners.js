/**
 * Local CRUD for partners (customers). Used for offline customer list.
 */
import { getDb } from './db.js';
import { empty, iso } from './dbHelpers.js';

export async function upsertPartners(rows) {
  if (!rows?.length) return;
  const db = await getDb();
  await db.withTransactionAsync(async (tx) => {
    for (const r of rows) {
      const id = r.id != null ? r.id : 0;
      await tx.runAsync(
        `INSERT OR REPLACE INTO partners (id, name, phone, updated_at) VALUES (?, ?, ?, ?)`,
        [id, empty(r.name), r.phone != null && r.phone !== '' ? r.phone : null, iso()]
      );
    }
  });
}

export async function getAllPartners() {
  const db = await getDb();
  const rows = await db.getAllAsync(
    `SELECT id, name, phone FROM partners ORDER BY name ASC`
  );
  return (rows || []).map((row) => ({
    id: row.id,
    name: row.name,
    phone: row.phone,
  }));
}
