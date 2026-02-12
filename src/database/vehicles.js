/**
 * Local CRUD for vehicles (Odoo fleet.vehicle mirror).
 */
import { getDb } from './db.js';
import { empty, num, numOrNull, iso } from './dbHelpers.js';

function odooRel(idName) {
  if (Array.isArray(idName)) return { id: idName[0], name: idName[1] ?? null };
  return { id: idName, name: null };
}

function strOrNull(v) {
  if (v == null || typeof v === 'object') return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

export async function upsertVehicles(rows) {
  if (!rows?.length) return;
  const db = await getDb();
  const now = iso();
  await db.withTransactionAsync(async (tx) => {
    for (const r of rows) {
      const modelId = Array.isArray(r.model_id) ? r.model_id[0] : r.model_id;
      await tx.runAsync(
        `INSERT OR REPLACE INTO vehicles (id, name, license_plate, model_id, updated_at) VALUES (?, ?, ?, ?, ?)`,
        [num(r.id), empty(r.name), strOrNull(r.license_plate), numOrNull(modelId), now]
      );
    }
  });
}

export async function getAllVehicles() {
  const db = await getDb();
  const rows = await db.getAllAsync(
    'SELECT id, name, license_plate, model_id FROM vehicles ORDER BY name ASC'
  );
  return (rows || []).map((row) => ({
    id: row.id,
    name: row.name,
    license_plate: row.license_plate,
    model_id: row.model_id != null ? [row.model_id, null] : null,
  }));
}
