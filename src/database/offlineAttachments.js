/**
 * Offline payment proof images: store local file path only (no base64).
 * Sync reads file → base64 at sync time; single message_post with attachments array.
 * Duplicate protection: if sync_status === 'synced' never resend.
 */
import { getDb } from './db.js';
import { empty, num, iso } from './dbHelpers.js';

export const SYNC_STATUS_PENDING = 'pending';
export const SYNC_STATUS_SYNCED = 'synced';
export const SYNC_STATUS_FAILED = 'failed';

export const MAX_RETRIES = 5;

/**
 * Insert a pending attachment (photo saved to device; will be uploaded on sync).
 * @param {object} row - { sale_order_id, local_file_path, file_name, mime_type }
 * @returns {Promise<number>} Insert id
 */
export async function insert(row) {
  const db = await getDb();
  const soId = num(row.sale_order_id);
  await db.runAsync(
    `INSERT INTO offline_attachments (sale_order_id, local_file_path, file_name, mime_type, sync_status, retry_count, created_at)
     VALUES (?, ?, ?, ?, ?, 0, ?)`,
    [
      soId,
      empty(row.local_file_path),
      empty(row.file_name),
      empty(row.mime_type) || 'image/jpeg',
      SYNC_STATUS_PENDING,
      iso(),
    ]
  );
  const inserted = await db.getFirstAsync(
    'SELECT id FROM offline_attachments WHERE sale_order_id = ? ORDER BY id DESC LIMIT 1',
    [soId]
  );
  return num(inserted?.id);
}

/**
 * Get all pending attachments for a sale order (sync_status = pending, retry_count < MAX_RETRIES).
 * Do NOT return if sync_status === 'synced' (duplicate protection).
 */
export async function getPendingBySaleOrderId(saleOrderId) {
  const db = await getDb();
  const rows = await db.getAllAsync(
    `SELECT id, sale_order_id, local_file_path, file_name, mime_type, sync_status, retry_count
     FROM offline_attachments
     WHERE sale_order_id = ? AND sync_status = ? AND retry_count < ?
     ORDER BY id ASC`,
    [num(saleOrderId), SYNC_STATUS_PENDING, MAX_RETRIES]
  );
  return (rows || []).map((r) => ({
    id: r.id,
    sale_order_id: r.sale_order_id,
    local_file_path: r.local_file_path,
    file_name: r.file_name,
    mime_type: r.mime_type,
    sync_status: r.sync_status,
    retry_count: r.retry_count,
  }));
}

/**
 * Get all pending attachments across all sale orders (for sync engine).
 * Process in batches; max 3 uploads at a time per doc.
 */
/** Count rows per sale order (any sync status). */
export async function getAttachmentCountsBySaleOrderIds(saleOrderIds) {
  if (!Array.isArray(saleOrderIds) || saleOrderIds.length === 0) return {};
  const db = await getDb();
  const ids = [...new Set(saleOrderIds.map((id) => num(id)).filter((n) => n > 0))];
  if (ids.length === 0) return {};
  const placeholders = ids.map(() => '?').join(',');
  const rows = await db.getAllAsync(
    `SELECT sale_order_id, COUNT(*) as c FROM offline_attachments WHERE sale_order_id IN (${placeholders}) GROUP BY sale_order_id`,
    ids
  );
  const out = {};
  for (const id of ids) out[id] = 0;
  for (const r of rows || []) {
    out[num(r.sale_order_id)] = num(r.c);
  }
  return out;
}

/** Sale orders that still have proof files not uploaded to Odoo. */
export async function getSaleOrderIdsWithPendingAttachmentUploads() {
  const db = await getDb();
  const rows = await db.getAllAsync(
    `SELECT DISTINCT sale_order_id FROM offline_attachments WHERE sync_status = ? AND retry_count < ?`,
    [SYNC_STATUS_PENDING, MAX_RETRIES]
  );
  return new Set((rows || []).map((r) => num(r.sale_order_id)));
}

export async function getAllPending(limit = 50) {
  const db = await getDb();
  const rows = await db.getAllAsync(
    `SELECT id, sale_order_id, local_file_path, file_name, mime_type, sync_status, retry_count
     FROM offline_attachments
     WHERE sync_status = ? AND retry_count < ?
     ORDER BY created_at ASC
     LIMIT ?`,
    [SYNC_STATUS_PENDING, MAX_RETRIES, limit]
  );
  return (rows || []).map((r) => ({
    id: r.id,
    sale_order_id: r.sale_order_id,
    local_file_path: r.local_file_path,
    file_name: r.file_name,
    mime_type: r.mime_type,
    sync_status: r.sync_status,
    retry_count: r.retry_count,
  }));
}

/**
 * Mark attachment as synced (upload succeeded). Set synced_at = now.
 */
export async function markSynced(id) {
  const db = await getDb();
  const now = iso();
  await db.runAsync(
    `UPDATE offline_attachments SET sync_status = ?, synced_at = ?, last_error = NULL WHERE id = ?`,
    [SYNC_STATUS_SYNCED, now, num(id)]
  );
}

/**
 * Mark a single attachment as failed (file missing / invalid base64). Do not retry.
 */
export async function markFailed(id, lastError) {
  const db = await getDb();
  await db.runAsync(
    `UPDATE offline_attachments SET sync_status = ?, last_error = ? WHERE id = ?`,
    [SYNC_STATUS_FAILED, empty(lastError), num(id)]
  );
}

/**
 * Increment retry_count and set last_error; if >= MAX_RETRIES, set sync_status = 'failed'.
 */
export async function incrementRetry(id, lastError = '') {
  const db = await getDb();
  await db.runAsync(
    `UPDATE offline_attachments SET retry_count = retry_count + 1, last_error = ? WHERE id = ?`,
    [empty(lastError), num(id)]
  );
  const row = await db.getFirstAsync(
    'SELECT retry_count FROM offline_attachments WHERE id = ?',
    [num(id)]
  );
  if (row && row.retry_count >= MAX_RETRIES) {
    await db.runAsync(
      `UPDATE offline_attachments SET sync_status = ? WHERE id = ?`,
      [SYNC_STATUS_FAILED, num(id)]
    );
  }
}
