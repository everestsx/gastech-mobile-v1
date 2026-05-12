import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'gastech_checkout_resume_v1';

async function readMap() {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return {};
  try {
    const o = JSON.parse(raw);
    return typeof o === 'object' && o !== null && !Array.isArray(o) ? o : {};
  } catch {
    return {};
  }
}

async function writeMap(map) {
  await AsyncStorage.setItem(KEY, JSON.stringify(map));
}

/**
 * After payment is saved locally, before opening the invoice flow.
 * @param {number|string} saleOrderId
 * @param {object} invoiceParams — navigation params for InvoiceScreen (JSON-serializable)
 */
export async function setCheckoutResumeFromPayment(saleOrderId, invoiceParams) {
  const id = String(saleOrderId);
  const map = await readMap();
  const params = { ...(invoiceParams || {}) };
  if (params.saleOrderId == null) params.saleOrderId = id;
  map[id] = {
    updatedAt: Date.now(),
    phase: 'invoice',
    invoiceParams: params,
  };
  await writeMap(map);
}

/**
 * User opened Proceed Payment (qty saved locally) but has not confirmed payment yet.
 * Keeps the order out of “Delivered” lists until invoice/payment flow completes or is abandoned after invoicing.
 */
export async function setCheckoutResumePaymentStarted(saleOrderId, draftParams = {}) {
  const id = String(saleOrderId);
  const map = await readMap();
  const existing = map[id];
  if (existing?.invoiceParams) return;
  map[id] = {
    updatedAt: Date.now(),
    phase: 'payment',
    paymentDraftParams: { ...(draftParams || {}), saleOrderId: id },
  };
  await writeMap(map);
}

export async function setCheckoutResumePhase(saleOrderId, phase) {
  const id = String(saleOrderId);
  const map = await readMap();
  const cur = map[id];
  if (!cur?.invoiceParams) return;
  const nextPhase = phase === 'payment_proof' ? 'payment_proof' : 'invoice';
  map[id] = { ...cur, phase: nextPhase, updatedAt: Date.now() };
  await writeMap(map);
}

export async function clearCheckoutResume(saleOrderId) {
  const map = await readMap();
  delete map[String(saleOrderId)];
  await writeMap(map);
}

export async function getCheckoutResumeEntry(saleOrderId) {
  const map = await readMap();
  return map[String(saleOrderId)] || null;
}

export async function getCheckoutResumeMap() {
  return readMap();
}

/** Sale order ids with checkout in progress (on Proceed Payment, invoice, or payment proof). */
export function pendingCheckoutSaleOrderIdsFromResumeMap(map) {
  const s = new Set();
  if (!map || typeof map !== 'object') return s;
  for (const [k, v] of Object.entries(map)) {
    if (v?.invoiceParams || v?.phase === 'payment') {
      const n = Number(k);
      if (Number.isFinite(n)) s.add(n);
    }
  }
  return s;
}

/**
 * Remove stale resume rows: no pending payment upload and SO is invoiced (local row or cached Odoo header).
 * Prevents “stuck pending” when the device synced successfully but resume was not cleared.
 */
export async function pruneStaleCheckoutResumeEntries() {
  const map = await readMap();
  const entries = Object.entries(map);
  if (!entries.length) return false;

  const syncQueue = await import('../database/syncQueue.js');
  const localInvoicesDb = await import('../database/localInvoices.js');
  const saleOrdersDb = await import('../database/saleOrders.js');

  const pendingPaymentIds = await syncQueue.getPendingPaymentSaleOrderIds();
  const syncedPaymentIds = await syncQueue.getSyncedPaymentSaleOrderIds();
  const localInvoiced = await localInvoicesDb.getSaleOrderIdsWithLocalInvoices();

  let changed = false;
  for (const [k, v] of entries) {
    const soId = Number(k);
    if (!Number.isFinite(soId)) continue;
    if (pendingPaymentIds.has(soId)) continue;

    let invoiced = localInvoiced.has(soId);
    if (!invoiced) {
      const row = await saleOrdersDb.getSaleOrderById(soId).catch(() => null);
      invoiced = row != null && String(row.invoice_status || '').toLowerCase() === 'invoiced';
    }
    const paymentSyncedNoPending = syncedPaymentIds.has(soId);
    if (!invoiced && !paymentSyncedNoPending) continue;

    const isPaymentDraftOnly = v?.phase === 'payment' && !v?.invoiceParams;
    const isPostPaymentCheckout = Boolean(v?.invoiceParams);
    if (!isPaymentDraftOnly && !isPostPaymentCheckout) continue;

    delete map[k];
    changed = true;
  }

  if (changed) await writeMap(map);
  return changed;
}
