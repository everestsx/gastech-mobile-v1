/**
 * Local CRUD for routes (Odoo route.master mirror).
 */
import { getDb } from './db.js';
import { empty, num, iso } from './dbHelpers.js';

export async function upsertRoutes(rows) {
  if (!rows?.length) return;
  const db = await getDb();
  const now = iso();
  await db.withTransactionAsync(async (tx) => {
    for (const r of rows) {
      await tx.runAsync(
        'INSERT OR REPLACE INTO routes (id, name, updated_at) VALUES (?, ?, ?)',
        [num(r.id), empty(r.name), now]
      );
    }
  });
}

export async function getRouteNameById(routeId) {
  const id = Number(routeId);
  if (!Number.isFinite(id) || id <= 0) return '';
  const db = await getDb();
  const row = await db.getFirstAsync('SELECT name FROM routes WHERE id = ?', [id]);
  return String(row?.name || '').trim();
}

export async function getAllRoutes() {
  const db = await getDb();
  const rows = await db.getAllAsync('SELECT id, name FROM routes ORDER BY name ASC');
  return rows || [];
}
