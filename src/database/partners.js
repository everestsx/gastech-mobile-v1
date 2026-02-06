/**
 * Local CRUD for partners (customers). Used for offline customer list.
 */

import { getDb } from './db.js';

export async function upsertPartners(rows) {
  if (!rows?.length) return;
  const db = await getDb();
  await db.withTransactionAsync(async (tx) => {
    for (const r of rows) {
      const id = r.id;
      const name = r.name ?? '';
      const phone = r.phone ?? null;
      const updated_at = new Date().toISOString();
      await tx.runAsync(
        `INSERT OR REPLACE INTO partners (id, name, phone, updated_at) VALUES (?, ?, ?, ?)`,
        [id, name, phone, updated_at]
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
