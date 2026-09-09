/**
 * Local history for gas leakage collects (My Leakage).
 */
import { getDb } from './db.js';
import { empty, iso, num } from './dbHelpers.js';

function parseMoves(raw) {
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    collectedAt: row.collected_at,
    partnerId: row.partner_id,
    partnerName: row.partner_name || '',
    saleOrderId: row.sale_order_id,
    reason: row.reason || '',
    moves: parseMoves(row.moves_json),
    source: row.source || '',
    queueId: row.queue_id,
    odooSyncStatus: row.odoo_sync_status || 'pending',
  };
}

export async function insertGasLeakageCollect(data) {
  const db = await getDb();
  const result = await db.runAsync(
    `INSERT INTO gas_leakage_collects
       (collected_at, partner_id, partner_name, sale_order_id, reason, moves_json, source, queue_id, odoo_sync_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.collectedAt || iso(),
      data.partnerId != null ? num(data.partnerId) : null,
      empty(data.partnerName),
      data.saleOrderId != null ? num(data.saleOrderId) : null,
      empty(data.reason),
      JSON.stringify(Array.isArray(data.moves) ? data.moves : []),
      empty(data.source),
      data.queueId != null ? num(data.queueId) : null,
      empty(data.odooSyncStatus) || 'pending',
    ]
  );
  return result?.lastInsertRowId ?? null;
}

export async function getAllGasLeakageCollects() {
  try {
    const db = await getDb();
    const rows = await db.getAllAsync(
      `SELECT * FROM gas_leakage_collects ORDER BY collected_at DESC, id DESC`
    );
    return (rows || []).map(mapRow);
  } catch (e) {
    console.warn('[gasLeakageCollects] getAll:', e?.message ?? e);
    return [];
  }
}

export async function markGasLeakageCollectSyncedByQueueId(queueId) {
  const id = num(queueId);
  if (!Number.isFinite(id) || id <= 0) return;
  try {
    const db = await getDb();
    await db.runAsync(
      `UPDATE gas_leakage_collects SET odoo_sync_status = 'synced' WHERE queue_id = ?`,
      [id]
    );
  } catch (e) {
    console.warn('[gasLeakageCollects] markSynced:', e?.message ?? e);
  }
}

export async function deleteAllGasLeakageCollects() {
  try {
    const db = await getDb();
    await db.runAsync('DELETE FROM gas_leakage_collects');
  } catch (e) {
    console.warn('[gasLeakageCollects] deleteAll:', e?.message ?? e);
  }
}
