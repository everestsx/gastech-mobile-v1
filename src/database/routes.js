/**
 * Local CRUD for routes (Odoo route.master mirror).
 */
import { getDb } from './db.js';

export async function upsertRoutes(rows) {
  if (!rows?.length) return;
  const db = await getDb();
  const now = new Date().toISOString();
  await db.withTransactionAsync(async (tx) => {
    for (const r of rows) {
      await tx.runAsync(
        'INSERT OR REPLACE INTO routes (id, name, updated_at) VALUES (?, ?, ?)',
        [r.id, r.name ?? '', now]
      );
    }
  });
}

export async function getAllRoutes() {
  const db = await getDb();
  const rows = await db.getAllAsync('SELECT id, name FROM routes ORDER BY name ASC');
  return rows || [];
}
