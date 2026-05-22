/**
 * Multi-vehicle offline history: keep delivered/invoiced data per vehicle for 7 days.
 * Never wipe other vehicles' rows on login, logout, or vehicle switch.
 */
import { getDb } from '../database/db.js';
import { num } from '../database/dbHelpers.js';
import * as syncQueueDb from '../database/syncQueue.js';
import * as localInvoicesDb from '../database/localInvoices.js';
import {
  getCheckoutResumeMap,
  pendingCheckoutSaleOrderIdsFromResumeMap,
} from './checkoutResume.service.js';

export const LOCAL_DELIVERY_HISTORY_RETENTION_DAYS = 7;

function retentionCutoffIso(days = LOCAL_DELIVERY_HISTORY_RETENTION_DAYS) {
  const d = new Date();
  d.setDate(d.getDate() - Math.max(1, Number(days) || 7));
  return d.toISOString();
}

/** Sale order ids that must never be auto-deleted (pending upload / checkout in progress). */
export async function getGloballyProtectedSaleOrderIds() {
  const protectedIds = new Set();
  try {
    const pending = await syncQueueDb.getPendingSaleOrderIds();
    for (const id of pending || []) {
      const n = Number(id);
      if (Number.isFinite(n) && n > 0) protectedIds.add(n);
    }
  } catch (_) {
    /* non-fatal */
  }
  try {
    const unsyncedInv = await localInvoicesDb.getUnsyncedLocalInvoiceSaleOrderIds();
    for (const id of unsyncedInv || []) {
      const n = Number(id);
      if (Number.isFinite(n) && n > 0) protectedIds.add(n);
    }
  } catch (_) {
    /* non-fatal */
  }
  try {
    const resumeMap = await getCheckoutResumeMap();
    for (const id of pendingCheckoutSaleOrderIdsFromResumeMap(resumeMap)) {
      const n = Number(id);
      if (Number.isFinite(n) && n > 0) protectedIds.add(n);
    }
  } catch (_) {
    /* non-fatal */
  }
  return protectedIds;
}

/**
 * Recent delivered/invoiced SO ids for one vehicle (within retention window).
 * Used so sync prune does not remove today's history when Odoo fetch window is narrower.
 */
export async function getRecentDeliveredSaleOrderIdsForVehicle(
  vehicleId,
  days = LOCAL_DELIVERY_HISTORY_RETENTION_DAYS
) {
  const vid = num(vehicleId);
  if (!Number.isFinite(vid) || vid <= 0) return new Set();
  const cutoff = retentionCutoffIso(days);
  const db = await getDb();
  const rows = await db.getAllAsync(
    `SELECT DISTINCT so.id AS id
     FROM sale_orders so
     LEFT JOIN local_invoices li ON li.sale_order_id = so.id
     WHERE so.vehicle_id = ?
       AND (
         (li.created_at IS NOT NULL AND li.created_at >= ?)
         OR (so.payment_type IS NOT NULL AND TRIM(so.payment_type) != '' AND so.updated_at >= ?)
         OR (LOWER(COALESCE(so.invoice_status, '')) = 'invoiced' AND so.updated_at >= ?)
       )`,
    [vid, cutoff, cutoff, cutoff]
  );
  const out = new Set();
  for (const r of rows || []) {
    const n = Number(r?.id);
    if (Number.isFinite(n) && n > 0) out.add(n);
  }
  return out;
}

/** All SO ids with a local invoice row for this vehicle. */
export async function getLocalInvoicedSaleOrderIdsForVehicle(vehicleId) {
  const vid = num(vehicleId);
  if (!Number.isFinite(vid) || vid <= 0) return new Set();
  const db = await getDb();
  const rows = await db.getAllAsync(
    `SELECT DISTINCT li.sale_order_id AS id
     FROM local_invoices li
     INNER JOIN sale_orders so ON so.id = li.sale_order_id
     WHERE so.vehicle_id = ?`,
    [vid]
  );
  const out = new Set();
  for (const r of rows || []) {
    const n = Number(r?.id);
    if (Number.isFinite(n) && n > 0) out.add(n);
  }
  return out;
}

/**
 * Build preserve set for sync prune: pending upload, local invoices, recent deliveries.
 */
export async function buildPreserveSaleOrderIdsForVehicleSync(vehicleId, extraIds = []) {
  const preserve = await getGloballyProtectedSaleOrderIds();
  for (const id of extraIds || []) {
    const n = Number(id);
    if (Number.isFinite(n) && n > 0) preserve.add(n);
  }
  if (vehicleId != null) {
    for (const id of await getLocalInvoicedSaleOrderIdsForVehicle(vehicleId)) {
      preserve.add(id);
    }
    for (const id of await getRecentDeliveredSaleOrderIdsForVehicle(vehicleId)) {
      preserve.add(id);
    }
  }
  return preserve;
}

async function deleteSaleOrdersCascade(orderIds = []) {
  const ids = [...new Set(orderIds.map((id) => num(id)).filter((id) => Number.isFinite(id) && id > 0))];
  if (!ids.length) return 0;
  const db = await getDb();
  const ph = ids.map(() => '?').join(',');
  await db.withTransactionAsync(async (tx) => {
    await tx.runAsync(`DELETE FROM sale_order_lines WHERE order_id IN (${ph})`, ids);
    const pickRows = await tx.getAllAsync(`SELECT id FROM stock_pickings WHERE sale_id IN (${ph})`, ids);
    const pickingIds = (pickRows || []).map((r) => num(r.id)).filter((id) => id > 0);
    if (pickingIds.length > 0) {
      const pph = pickingIds.map(() => '?').join(',');
      const moveRows = await tx.getAllAsync(
        `SELECT id FROM stock_moves WHERE picking_id IN (${pph})`,
        pickingIds
      );
      const moveIds = (moveRows || []).map((r) => num(r.id)).filter((id) => id > 0);
      if (moveIds.length > 0) {
        const mph = moveIds.map(() => '?').join(',');
        await tx.runAsync(`DELETE FROM stock_move_lines WHERE move_id IN (${mph})`, moveIds);
        await tx.runAsync(`DELETE FROM stock_moves WHERE id IN (${mph})`, moveIds);
      }
      await tx.runAsync(`DELETE FROM stock_pickings WHERE id IN (${pph})`, pickingIds);
    }
    await tx.runAsync(`DELETE FROM local_invoices WHERE sale_order_id IN (${ph})`, ids);
    try {
      await tx.runAsync(`DELETE FROM local_payments WHERE sale_order_id IN (${ph})`, ids);
    } catch (_) {
      /* table may be absent on very old DBs */
    }
    await tx.runAsync(`DELETE FROM offline_attachments WHERE sale_order_id IN (${ph})`, ids);
    await tx.runAsync(`DELETE FROM sale_orders WHERE id IN (${ph})`, ids);
  });
  return ids.length;
}

/**
 * Remove completed local delivery/invoice history older than retention for one vehicle (or all).
 * Never deletes pending upload, unsynced invoices, or checkout-in-progress orders.
 */
export async function pruneExpiredLocalDeliveryHistory(options = {}) {
  const vehicleId = options.vehicleId != null ? num(options.vehicleId) : null;
  const days = options.retentionDays ?? LOCAL_DELIVERY_HISTORY_RETENTION_DAYS;
  const cutoff = retentionCutoffIso(days);
  const protectedIds = await getGloballyProtectedSaleOrderIds();
  const db = await getDb();

  const scopedVehicle = Number.isFinite(vehicleId) && vehicleId > 0;
  const vehicleClause = scopedVehicle ? 'AND so.vehicle_id = ?' : '';
  const args = scopedVehicle ? [cutoff, cutoff, vehicleId] : [cutoff, cutoff];

  const candidates = await db.getAllAsync(
    `SELECT so.id AS id
     FROM sale_orders so
     LEFT JOIN local_invoices li ON li.sale_order_id = so.id
     WHERE (
       (li.id IS NOT NULL AND li.created_at < ? AND li.synced_at IS NOT NULL AND TRIM(li.synced_at) != '')
       OR (
         li.id IS NULL
         AND so.payment_type IS NOT NULL
         AND TRIM(so.payment_type) != ''
         AND so.updated_at < ?
       )
     )
     ${vehicleClause}`,
    args
  );

  const toDelete = [];
  for (const row of candidates || []) {
    const id = Number(row?.id);
    if (!Number.isFinite(id) || id <= 0) continue;
    if (protectedIds.has(id)) continue;
    toDelete.push(id);
  }

  if (!toDelete.length) return { deleted: 0 };
  const deleted = await deleteSaleOrdersCascade(toDelete);
  return { deleted };
}
