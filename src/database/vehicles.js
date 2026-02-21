/**
 * Local CRUD for vehicles (Odoo fleet.vehicle mirror).
 */
import { getDb } from './db.js';


function odooRel(idName) {
  if (Array.isArray(idName)) return { id: idName[0], name: idName[1] ?? null };
  return { id: idName, name: null };
}

function strOrNull(v) {
  if (v == null || typeof v === 'object') return null;
  const s = String(v).trim();
  return s === '' ? null : s;
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


export async function upsertVehicles(rows) {
  if (!rows?.length) return;
  const db = await getDb();
  const now = new Date().toISOString();

  await db.withTransactionAsync(async (tx) => {
    for (const r of rows) {
      const deterministicPIN = ((r.id * 12345) % 9000 + 1000).toString();

      await tx.runAsync(
          `INSERT INTO vehicles (id, name, license_plate, password, updated_at) 
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           license_plate = excluded.license_plate,
           updated_at = excluded.updated_at
           -- If the driver manually changed the PIN, we keep it.
           -- If it's a new install/sync, we use the deterministic one.`,
          [r.id, r.name, r.license_plate, deterministicPIN, now]
      );
    }
  });
}
