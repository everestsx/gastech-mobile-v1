/**
 * Offline-first sale order cancellation: local state + sync queue → Odoo on reconnect.
 */
import * as saleOrdersDb from '../database/saleOrders.js';
import * as stockPickingsDb from '../database/stockPickings.js';
import * as syncQueueDb from '../database/syncQueue.js';
import { getCancellationReasonLabel } from '../database/cancellationReasons.js';
import { clearCheckoutResume } from '../services/checkoutResume.service.js';

/** Apply cancel locally (UI + SQLite) and clear pending delivery/payment work for this SO. */
export async function applyOrderCancelLocally(saleOrderId, reason = '') {
  const soId = Number(saleOrderId);
  if (!Number.isFinite(soId) || soId <= 0) return;

  const reasonStr = String(reason || '').trim();
  const reasonLabel = await getCancellationReasonLabel(reasonStr).catch(() => reasonStr);

  const pickings = await stockPickingsDb.getStockPickingsBySaleId(soId);
  await Promise.all(
    (pickings || []).map((p) =>
      p?.id != null ? stockPickingsDb.updatePickingStateLocal(p.id, 'cancel') : Promise.resolve()
    )
  );

  /** Drop delivery/payment/inventory queue — keep pending order_cancel rows. */
  await syncQueueDb.deletePendingItemsBySaleOrderId(soId);

  await saleOrdersDb.updateSaleOrderCancelLocal(soId, reasonStr);
  try {
    await clearCheckoutResume(soId);
  } catch (_) {
    /* non-fatal */
  }

  return { reason: reasonStr, reasonLabel };
}

/** Queue Odoo cancel for when the device is back online (background sync). */
export async function enqueueOrderCancelSync(saleOrderId, reason, extra = {}) {
  const soId = Number(saleOrderId);
  if (!Number.isFinite(soId) || soId <= 0) return null;
  const reasonStr = String(reason || '').trim();
  const reasonLabel =
    extra.reasonLabel != null
      ? String(extra.reasonLabel)
      : await getCancellationReasonLabel(reasonStr).catch(() => reasonStr);

  const existing = await syncQueueDb.getPendingCancelItemBySaleOrderId(soId);
  const payload = {
    saleOrderId: soId,
    reason: reasonStr,
    reasonLabel,
    cancelledAt: new Date().toISOString(),
    ...extra,
  };
  if (existing?.id != null) {
    await syncQueueDb.updateQueueItemPayload(existing.id, payload, {
      actionType: syncQueueDb.ACTION_CANCEL_ORDER,
    });
    return existing.id;
  }
  return syncQueueDb.enqueue(syncQueueDb.ACTION_CANCEL_ORDER, payload);
}

/**
 * Cancel order: always save locally + queue first; Odoo runs in background via sync queue.
 * UI must not wait on network (offline and online behave the same from driver view).
 */
export async function cancelSaleOrderOfflineFirst(saleOrderId, reason) {
  const soId = Number(saleOrderId);
  if (!Number.isFinite(soId) || soId <= 0) {
    throw new Error('Invalid sale order');
  }
  const reasonStr = String(reason || '').trim();
  if (!reasonStr) {
    throw new Error('Cancel reason is required');
  }

  const { reasonLabel } = await applyOrderCancelLocally(soId, reasonStr);
  const queueId = await enqueueOrderCancelSync(soId, reasonStr, { reasonLabel });

  try {
    const { schedulePendingUploadSync, trySyncPendingOrderCancelNow } = await import(
      '../services/sync.service.js'
    );
    schedulePendingUploadSync({ immediate: true, queuePasses: 15 });
    void trySyncPendingOrderCancelNow(soId, reasonStr, queueId);
  } catch (_) {
    /* non-fatal */
  }

  return { mode: 'queued', queued: true, queueId };
}
