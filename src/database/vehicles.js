/**
 * Local CRUD for vehicles (Odoo fleet.vehicle mirror).
 * Includes cash_journal_id and check_journal_id for offline Cash/Cheque payments.
 */
import { getDb } from './db.js';

function numOrNull(v) {
  if (v == null) return null;
  if (Array.isArray(v)) return v[0] != null ? Number(v[0]) : null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}


// export async function getAllVehicles() {
//   const db = await getDb();
//   const rows = await db.getAllAsync(
//     'SELECT id, name, license_plate, model_id FROM vehicles ORDER BY name ASC'
//   );
//   return (rows || []).map((row) => ({
//     id: row.id,
//     name: row.name,
//     license_plate: row.license_plate,
//     model_id: row.model_id != null ? [row.model_id, null] : null,
//   }));
// }
export async function getAllVehicles() {
  const db = await getDb();
  const rows = await db.getAllAsync(
      'SELECT id, name, license_plate, model_id FROM vehicles ORDER BY name ASC'
  );

  // --- DEBUG LOGS ---
  console.log(`--- Total Vehicles in DB: ${rows.length} ---`);
  rows.forEach((row, index) => {
    console.log(`Vehicle [${index}]: ID=${row.id} | Plate=${row.license_plate} | Name=${row.name}`);
  });
  console.log('------------------------------------------');
  // ------------------

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
      const cashJid = numOrNull(r.cash_journal_id);
      const checkJid = numOrNull(r.check_journal_id);

      await tx.runAsync(
          `INSERT INTO vehicles (id, name, license_plate, password, cash_journal_id, check_journal_id, updated_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           license_plate = excluded.license_plate,
           cash_journal_id = excluded.cash_journal_id,
           check_journal_id = excluded.check_journal_id,
           updated_at = excluded.updated_at`,
          [r.id, r.name, r.license_plate, deterministicPIN, cashJid, checkJid, now]
      );
    }
  });
}

/**
 * Get vehicle's cash and cheque journal ids from local DB (for offline Cash/Cheque payments).
 * @param {string} licensePlate - Vehicle number (license_plate)
 * @returns {Promise<{ cashJournalId: number | null, chequeJournalId: number | null }>}
 */
export async function getVehicleJournalsByLicensePlate(licensePlate) {
  if (!licensePlate || String(licensePlate).trim() === '') return { cashJournalId: null, chequeJournalId: null };
  const db = await getDb();
  const trimmed = String(licensePlate).trim();
  let row = await db.getFirstAsync(
    'SELECT cash_journal_id, check_journal_id FROM vehicles WHERE TRIM(license_plate) = ? LIMIT 1',
    [trimmed]
  );
  if (!row && trimmed !== '') {
    row = await db.getFirstAsync(
      'SELECT cash_journal_id, check_journal_id FROM vehicles WHERE license_plate = ? LIMIT 1',
      [trimmed]
    );
  }
  if (!row) return { cashJournalId: null, chequeJournalId: null };
  return {
    cashJournalId: numOrNull(row.cash_journal_id),
    chequeJournalId: numOrNull(row.check_journal_id),
  };
}

/**
 * Get vehicle's cash and cheque journal ids by vehicle id (fallback when lookup by license_plate finds no row).
 * @param {number} vehicleId
 * @returns {Promise<{ cashJournalId: number | null, chequeJournalId: number | null }>}
 */
export async function getVehicleJournalsByVehicleId(vehicleId) {
  if (vehicleId == null) return { cashJournalId: null, chequeJournalId: null };
  const db = await getDb();
  const row = await db.getFirstAsync(
    'SELECT cash_journal_id, check_journal_id FROM vehicles WHERE id = ? LIMIT 1',
    [Number(vehicleId)]
  );
  if (!row) return { cashJournalId: null, chequeJournalId: null };
  return {
    cashJournalId: numOrNull(row.cash_journal_id),
    chequeJournalId: numOrNull(row.check_journal_id),
  };
}

/**
 * Update vehicle's journal ids in local DB (e.g. after fetching from API).
 * @param {string} licensePlate
 * @param {number | null} cashJournalId
 * @param {number | null} chequeJournalId
 */
export async function updateVehicleJournals(licensePlate, cashJournalId, chequeJournalId) {
  if (!licensePlate || String(licensePlate).trim() === '') return;
  const db = await getDb();
  const now = new Date().toISOString();
  await db.runAsync(
    'UPDATE vehicles SET cash_journal_id = ?, check_journal_id = ?, updated_at = ? WHERE license_plate = ?',
    [numOrNull(cashJournalId), numOrNull(chequeJournalId), now, String(licensePlate).trim()]
  );
}
