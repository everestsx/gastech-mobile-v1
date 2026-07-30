/**
 * postcheckSubmissions.js
 * Local-only storage for Post Check (cash & cheque handover) submissions.
 *
 * Data is cleared on logout and designed to be forward-compatible with Odoo:
 * the `odoo_sync_status` column will be set to 'synced' once the backend API exists.
 */
import { getDb } from './db.js';

/**
 * Insert a new postcheck submission record.
 * @param {object} data
 * @param {string} data.submittedAt       - ISO datetime
 * @param {number|null} data.driverId
 * @param {string|null} data.driverName
 * @param {number|null} data.vehicleId
 * @param {string|null} data.vehicleName
 * @param {number} data.cashTotal
 * @param {number} data.chequeTotal
 * @param {number} data.creditTotal
 * @param {string} data.dropoffLocation   - 'showroom' | 'headoffice'
 * @param {number} data.ordersSynced
 * @param {number} data.ordersPending
 * @returns {Promise<number>} inserted row id
 */
export async function insertPostCheckSubmission(data) {
  const db = await getDb();
  const result = await db.runAsync(
    `INSERT INTO postcheck_submissions
       (submitted_at, driver_id, driver_name, vehicle_id, vehicle_name,
        cash_total, cheque_total, credit_total, dropoff_location,
        orders_synced, orders_pending, odoo_sync_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    [
      data.submittedAt,
      data.driverId ?? null,
      data.driverName ?? null,
      data.vehicleId ?? null,
      data.vehicleName ?? null,
      data.cashTotal ?? 0,
      data.chequeTotal ?? 0,
      data.creditTotal ?? 0,
      data.dropoffLocation ?? 'showroom',
      data.ordersSynced ?? 0,
      data.ordersPending ?? 0,
    ]
  );
  return result?.lastInsertRowId ?? null;
}

/**
 * Get all postcheck submissions, newest first.
 * @returns {Promise<Array>}
 */
export async function getAllPostCheckSubmissions() {
  try {
    const db = await getDb();
    return await db.getAllAsync(
      `SELECT * FROM postcheck_submissions ORDER BY submitted_at DESC`
    );
  } catch (e) {
    console.warn('[postcheckSubmissions] getAllPostCheckSubmissions:', e?.message ?? e);
    return [];
  }
}

/**
 * Get submissions for a specific driver (for future filtering).
 * @param {number} driverId
 * @returns {Promise<Array>}
 */
export async function getPostCheckSubmissionsByDriver(driverId) {
  try {
    const db = await getDb();
    return await db.getAllAsync(
      `SELECT * FROM postcheck_submissions WHERE driver_id = ? ORDER BY submitted_at DESC`,
      [driverId]
    );
  } catch (e) {
    console.warn('[postcheckSubmissions] getPostCheckSubmissionsByDriver:', e?.message ?? e);
    return [];
  }
}

/**
 * Delete ALL postcheck submissions.
 * Called on logout — data is session-scoped until Odoo backend is ready.
 */
export async function deleteAllPostCheckSubmissions() {
  try {
    const db = await getDb();
    await db.runAsync(`DELETE FROM postcheck_submissions`);
  } catch (e) {
    console.warn('[postcheckSubmissions] deleteAllPostCheckSubmissions:', e?.message ?? e);
  }
}

/**
 * Delete a single postcheck submission by id.
 * @param {number} id
 */
export async function deletePostCheckSubmission(id) {
  try {
    const db = await getDb();
    await db.runAsync(`DELETE FROM postcheck_submissions WHERE id = ?`, [id]);
  } catch (e) {
    console.warn('[postcheckSubmissions] deletePostCheckSubmission:', e?.message ?? e);
  }
}

/**
 * Mark a submission as synced to Odoo (for future backend integration).
 * @param {number} id
 * @param {string} [odooId]
 */
export async function markPostCheckSubmissionSynced(id, odooId) {
  try {
    const db = await getDb();
    await db.runAsync(
      `UPDATE postcheck_submissions SET odoo_sync_status = 'synced' WHERE id = ?`,
      [id]
    );
  } catch (e) {
    console.warn('[postcheckSubmissions] markPostCheckSubmissionSynced:', e?.message ?? e);
  }
}
