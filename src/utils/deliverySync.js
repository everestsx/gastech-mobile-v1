/**
 * Offline delivery sync helpers: stable transaction ids, frozen qty snapshots, sanity checks.
 * Mobile confirmed quantity is the single source of truth for Odoo writes.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const DEVICE_ID_KEY = '@gastech_mobile_device_id';
/** Hard cap — catches corrupted multiplication before Odoo write. */
export const MAX_ABS_DELIVERED_QTY = 500;

/** Round to 3 decimals — matches sync.service delivered-qty verification. */
export function coerceDeliveredQty(q) {
  const n = Number(q);
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 1000) / 1000;
}

/** One stable id per mobile delivery confirmation (survives queue payload updates). */
export function generateDeliveryTxnId(saleOrderId) {
  const so = Number(saleOrderId);
  const soPart = Number.isFinite(so) && so > 0 ? String(so) : '0';
  return `mob-del-${soPart}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Stable device id for idempotent delivery dedupe on Odoo (when custom module is deployed). */
export async function getOrCreateMobileDeviceId() {
  try {
    const existing = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (existing && String(existing).trim()) return String(existing).trim();
    const id = `mob-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
    await AsyncStorage.setItem(DEVICE_ID_KEY, id);
    return id;
  } catch (_) {
    return 'mob-unknown';
  }
}

function clonePickingBlock(b = {}) {
  return {
    pickingId: b.pickingId != null ? Number(b.pickingId) : b.picking_id != null ? Number(b.picking_id) : null,
    deliveryLines: (b.deliveryLines || [])
      .map((l) => {
        const moveIdRaw = Number(l?.moveId ?? l?.move_id);
        const productId = Number(l?.productId ?? l?.product_id);
        const qty_done = coerceDeliveredQty(l?.qty_done);
        if (!Number.isFinite(qty_done)) return null;
        // Keep product→qty authority even when moveId is offline/synthetic (<=0).
        // Sync remaps to live Odoo move ids; dropping these caused empty retry snapshots.
        if (Number.isFinite(moveIdRaw) && moveIdRaw > 0) {
          return {
            moveId: moveIdRaw,
            productId: Number.isFinite(productId) && productId > 0 ? productId : null,
            qty_done,
          };
        }
        if (Number.isFinite(productId) && productId > 0) {
          return { moveId: null, productId, qty_done };
        }
        return null;
      })
      .filter(Boolean),
    moveLineUpdates: (b.moveLineUpdates || [])
      .map((u) => {
        const moveLineIdRaw = Number(u?.moveLineId);
        const moveIdRaw = Number(u?.moveId);
        const productId = Number(u?.productId ?? u?.product_id);
        const qty_done = coerceDeliveredQty(u?.qty_done);
        if (!Number.isFinite(qty_done)) return null;
        if (Number.isFinite(moveLineIdRaw) && moveLineIdRaw > 0) {
          return {
            moveLineId: moveLineIdRaw,
            moveId: Number.isFinite(moveIdRaw) && moveIdRaw > 0 ? moveIdRaw : null,
            productId: Number.isFinite(productId) && productId > 0 ? productId : null,
            qty_done,
          };
        }
        // Product-only row — enough to rebuild move lines on sync.
        if (Number.isFinite(productId) && productId > 0) {
          return {
            moveLineId: null,
            moveId: Number.isFinite(moveIdRaw) && moveIdRaw > 0 ? moveIdRaw : null,
            productId,
            qty_done,
          };
        }
        return null;
      })
      .filter(Boolean),
  };
}

/**
 * Immutable qty snapshot at driver confirmation — never recomputed on queue retry.
 */
export function buildMobileQtySnapshot(payload = {}) {
  const so = Number(payload.saleOrderId ?? payload.sale_id);
  const requestedQtyByProduct = {};
  for (const [pid, qtyRaw] of Object.entries(payload.requestedQtyByProduct || {})) {
    const q = coerceDeliveredQty(qtyRaw);
    if (Number.isFinite(q) && q >= 0) requestedQtyByProduct[String(pid)] = q;
  }

  const sourceBlocks =
    Array.isArray(payload.pickings) && payload.pickings.length > 0
      ? payload.pickings
      : payload.pickingId != null
        ? [
            {
              pickingId: payload.pickingId,
              deliveryLines: payload.deliveryLines,
              moveLineUpdates: payload.moveLineUpdates,
            },
          ]
        : [];

  const saleOrderLineDeliveredUpdates = (payload.saleOrderLineDeliveredUpdates || [])
    .map((u) => ({
      lineId: Number(u?.lineId),
      qty_delivered: coerceDeliveredQty(u?.qty_delivered),
    }))
    .filter((u) => Number.isFinite(u.lineId) && u.lineId > 0 && Number.isFinite(u.qty_delivered));

  const invoiceLineQtys = Array.isArray(payload.invoiceLineQtys)
    ? payload.invoiceLineQtys.map((row) => ({
        lineId: Number(row?.lineId ?? row?.line_id),
        productId: Number(row?.productId ?? row?.product_id),
        qty: coerceDeliveredQty(row?.qty ?? row?.quantity),
      }))
    : [];

  return {
    version: 1,
    saleOrderId: Number.isFinite(so) && so > 0 ? so : null,
    requestedQtyByProduct,
    pickings: sourceBlocks.map(clonePickingBlock),
    saleOrderLineDeliveredUpdates,
    invoiceLineQtys,
    capturedAt: payload.mobileConfirmedAt || new Date().toISOString(),
  };
}

/** Picking blocks for sync: prefer frozen snapshot over live payload (prevents retry drift). */
export function pickingsBlocksFromDeliveryPayload(payload = {}) {
  const frozen = payload?.mobileQtySnapshot;
  if (frozen?.pickings?.length) {
    return frozen.pickings.map((b) => ({
      pickingId: b.pickingId,
      moveUpdates: [],
      moveLineUpdates: (b.moveLineUpdates || []).map((u) => ({ ...u })),
      deliveryLines: (b.deliveryLines || []).map((l) => ({ ...l })),
    }));
  }
  const p = payload || {};
  if (Array.isArray(p.pickings) && p.pickings.length > 0) {
    return p.pickings.map((b) => ({
      pickingId: b.pickingId ?? b.picking_id,
      moveUpdates: b.moveUpdates || [],
      moveLineUpdates: b.moveLineUpdates || [],
      deliveryLines: b.deliveryLines || [],
    }));
  }
  const pid = p.pickingId ?? p.picking_id;
  if (pid != null) {
    return [
      {
        pickingId: pid,
        moveUpdates: p.moveUpdates || [],
        moveLineUpdates: p.moveLineUpdates || [],
        deliveryLines: p.deliveryLines || [],
      },
    ];
  }
  return [];
}

/** Compact view for audit rows. */
export function auditQtyViewFromPayload(payload = {}) {
  const snap = payload.mobileQtySnapshot || buildMobileQtySnapshot(payload);
  return {
    deliveryTxnId: payload.deliveryTxnId || null,
    requestedQtyByProduct: snap.requestedQtyByProduct || {},
    pickings: snap.pickings || [],
    saleOrderLineDeliveredUpdates: snap.saleOrderLineDeliveredUpdates || [],
    invoiceLineQtys: snap.invoiceLineQtys || [],
  };
}

/** Checkout invoice qty by product (only rows that carry productId). */
export function qtyByProductFromInvoiceLines(invoiceLineQtys = []) {
  const map = {};
  for (const row of invoiceLineQtys || []) {
    const pid = Number(row?.productId ?? row?.product_id);
    const q = coerceDeliveredQty(row?.qty ?? row?.quantity);
    if (!Number.isFinite(pid) || pid <= 0 || !Number.isFinite(q) || q < 0) continue;
    const key = String(pid);
    map[key] = coerceDeliveredQty((Number(map[key]) || 0) + q);
  }
  return map;
}

/**
 * Never raise requested qty from invoice (invoice can include non-stock lines).
 * Never leave requested ABOVE invoiced for products present on both (Kodituwakku 15 vs 10).
 */
export function capRequestedQtyToInvoice(requestedQtyByProduct = {}, invoiceByProduct = {}) {
  const out = {};
  for (const [k, v] of Object.entries(requestedQtyByProduct || {})) {
    const pid = Number(k);
    const req = coerceDeliveredQty(v);
    if (!Number.isFinite(pid) || pid <= 0 || !Number.isFinite(req)) continue;
    const invRaw = invoiceByProduct[String(pid)] ?? invoiceByProduct[pid] ?? invoiceByProduct[k];
    const inv = coerceDeliveredQty(invRaw);
    out[String(pid)] = Number.isFinite(inv) && inv + 0.0001 < req ? inv : req;
  }
  return out;
}

/**
 * Confirmed qty per product on picking blocks.
 * deliveryLines and moveLineUpdates are the same checkout written twice — never add them.
 */
function productQtyClaimedByBlocks(blocks = []) {
  const totals = new Map();
  for (const b of blocks || []) {
    const fromLines = new Map();
    const fromMl = new Map();
    for (const line of b.deliveryLines || []) {
      const pid = Number(line?.productId ?? line?.product_id);
      const q = coerceDeliveredQty(line?.qty_done);
      if (!Number.isFinite(pid) || pid <= 0 || !Number.isFinite(q)) continue;
      fromLines.set(pid, coerceDeliveredQty((fromLines.get(pid) || 0) + q));
    }
    for (const u of b.moveLineUpdates || []) {
      const pid = Number(u?.productId ?? u?.product_id);
      const q = coerceDeliveredQty(u?.qty_done);
      if (!Number.isFinite(pid) || pid <= 0 || !Number.isFinite(q)) continue;
      fromMl.set(pid, coerceDeliveredQty((fromMl.get(pid) || 0) + q));
    }
    const pids = new Set([...fromLines.keys(), ...fromMl.keys()]);
    for (const pid of pids) {
      const claimed = fromLines.has(pid) ? fromLines.get(pid) : fromMl.get(pid);
      totals.set(pid, coerceDeliveredQty((totals.get(pid) || 0) + claimed));
    }
  }
  return totals;
}

/** Scale picking qty_done down when it exceeds checkout invoice qty for that product. No-op when they match. */
export function capPickingBlocksToProductQtyMap(blocks = [], maxQtyByProduct = {}, requestedQtyByProduct = null) {
  const maxMap = new Map();
  for (const [k, v] of Object.entries(maxQtyByProduct || {})) {
    const pid = Number(k);
    const q = coerceDeliveredQty(v);
    if (!Number.isFinite(pid) || pid <= 0 || !Number.isFinite(q) || q < 0) continue;
    maxMap.set(pid, q);
  }
  if (maxMap.size === 0) return blocks;

  const totals = productQtyClaimedByBlocks(blocks);

  const factorByProduct = new Map();
  for (const [pid, have] of totals.entries()) {
    if (!maxMap.has(pid)) continue;
    const want = maxMap.get(pid);
    if (have > want + 0.0001 && have > 0) {
      factorByProduct.set(pid, want / have);
      continue;
    }
    // Restore payloads already halved by the old double-count cap (18+18 vs invoice 18 → 9).
    const req = coerceDeliveredQty(
      requestedQtyByProduct?.[String(pid)] ?? requestedQtyByProduct?.[pid]
    );
    if (
      have > 0 &&
      want > 0 &&
      have + 0.0001 < want &&
      Number.isFinite(req) &&
      Math.abs(req - want) <= 0.02 &&
      Math.abs(have * 2 - want) <= 0.02
    ) {
      factorByProduct.set(pid, want / have);
    }
  }
  if (factorByProduct.size === 0) return blocks;

  const scaleList = (list) =>
    (list || []).map((row) => {
      const pid = Number(row?.productId ?? row?.product_id);
      const factor = factorByProduct.get(pid);
      if (factor == null) return { ...row };
      const q = coerceDeliveredQty(row?.qty_done);
      if (!Number.isFinite(q)) return { ...row };
      return { ...row, qty_done: coerceDeliveredQty(q * factor) };
    });

  return (blocks || []).map((b) => ({
    ...b,
    deliveryLines: scaleList(b.deliveryLines),
    moveLineUpdates: scaleList(b.moveLineUpdates),
  }));
}

/**
 * Failure-path only: if frozen pickings / requested qty drifted above the checkout invoice
 * (colleague devices, retry, go-back-and-reduce), cap them. Matching payloads are unchanged.
 */
export function applyCheckoutInvoiceQtyCapToPayload(payload, invoiceByProductOverride = null) {
  if (!payload || typeof payload !== 'object') return payload;
  const invRows =
    Array.isArray(payload.invoiceLineQtys) && payload.invoiceLineQtys.length > 0
      ? payload.invoiceLineQtys
      : payload.mobileQtySnapshot?.invoiceLineQtys;
  const invoiceByProduct =
    invoiceByProductOverride && Object.keys(invoiceByProductOverride).length > 0
      ? Object.fromEntries(
          Object.entries(invoiceByProductOverride).map(([k, v]) => [String(Number(k) || k), coerceDeliveredQty(v)])
        )
      : qtyByProductFromInvoiceLines(invRows);
  const usableInvoice = {};
  for (const [k, v] of Object.entries(invoiceByProduct || {})) {
    const pid = Number(k);
    const q = coerceDeliveredQty(v);
    if (!Number.isFinite(pid) || pid <= 0 || !Number.isFinite(q) || q < 0) continue;
    usableInvoice[String(pid)] = q;
  }
  if (Object.keys(usableInvoice).length === 0) return payload;

  const out = { ...payload };
  const reqSrc = out.mobileQtySnapshot?.requestedQtyByProduct || out.requestedQtyByProduct || {};
  const cappedReq = capRequestedQtyToInvoice(reqSrc, usableInvoice);
  out.requestedQtyByProduct = cappedReq;
  if (Array.isArray(out.pickings) && out.pickings.length > 0) {
    out.pickings = capPickingBlocksToProductQtyMap(out.pickings, usableInvoice, cappedReq);
  }
  if (out.mobileQtySnapshot && typeof out.mobileQtySnapshot === 'object') {
    const snapReq = capRequestedQtyToInvoice(
      out.mobileQtySnapshot.requestedQtyByProduct || cappedReq,
      usableInvoice
    );
    out.mobileQtySnapshot = {
      ...out.mobileQtySnapshot,
      requestedQtyByProduct: snapReq,
      pickings: capPickingBlocksToProductQtyMap(
        out.mobileQtySnapshot.pickings || [],
        usableInvoice,
        snapReq
      ),
    };
  }
  return out;
}

/**
 * Ensure payload carries deliveryTxnId + frozen mobile qty snapshot metadata.
 * Called on enqueue / updateQueueItemPayload only. Snapshot is set once and never replaced.
 */
export async function ensureDeliveryTxnOnPayload(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  const out = { ...payload };
  const txn = String(out.deliveryTxnId || '').trim();
  if (!txn) {
    const so = out.saleOrderId ?? out.sale_id;
    out.deliveryTxnId = generateDeliveryTxnId(so);
  }
  if (!out.mobileConfirmedAt) {
    out.mobileConfirmedAt = new Date().toISOString();
  }
  if (!out.deviceId) {
    out.deviceId = await getOrCreateMobileDeviceId();
  }
  out.syncTimestamp = out.syncTimestamp || out.mobileConfirmedAt || new Date().toISOString();
  if (!out.mobileQtySnapshot || out.mobileQtySnapshot.version !== 1) {
    out.mobileQtySnapshot = buildMobileQtySnapshot(out);
  } else if (Array.isArray(out.invoiceLineQtys) && out.invoiceLineQtys.length > 0) {
    // Checkout may add invoiceLineQtys after first enqueue — keep frozen snapshot aligned for retries.
    const fromInvoice = out.invoiceLineQtys
      .map((row) => ({
        lineId: Number(row?.lineId ?? row?.line_id),
        qty_delivered: coerceDeliveredQty(row?.qty ?? row?.quantity),
      }))
      .filter((u) => Number.isFinite(u.lineId) && u.lineId > 0 && Number.isFinite(u.qty_delivered));
    out.mobileQtySnapshot = {
      ...out.mobileQtySnapshot,
      invoiceLineQtys: out.invoiceLineQtys.map((row) => ({
        lineId: Number(row?.lineId ?? row?.line_id),
        productId: Number(row?.productId ?? row?.product_id),
        qty: coerceDeliveredQty(row?.qty ?? row?.quantity),
      })),
      saleOrderLineDeliveredUpdates:
        fromInvoice.length > 0
          ? fromInvoice
          : (out.saleOrderLineDeliveredUpdates || [])
              .map((u) => ({
                lineId: Number(u?.lineId),
                qty_delivered: coerceDeliveredQty(u?.qty_delivered),
              }))
              .filter((u) => Number.isFinite(u.lineId) && u.lineId > 0 && Number.isFinite(u.qty_delivered)),
    };
    if (fromInvoice.length > 0) {
      out.saleOrderLineDeliveredUpdates = fromInvoice;
    }
  }
  // Cap frozen pickings to checkout invoice qty when they drifted above it (does nothing when they match).
  return applyCheckoutInvoiceQtyCapToPayload(out);
}

/**
 * Reject impossible qty before any Odoo stock write (retry / duplicate protection).
 */
export function validateDeliveryPayloadSanity(payload, deliveredUpdates = []) {
  const checkQty = (q, label) => {
    const n = coerceDeliveredQty(q);
    if (!Number.isFinite(n) || n < 0) {
      return { ok: false, reason: `Invalid delivered qty (${label})` };
    }
    if (n > MAX_ABS_DELIVERED_QTY) {
      return {
        ok: false,
        reason: `Delivered qty ${n} exceeds safety limit (${MAX_ABS_DELIVERED_QTY}) for ${label}`,
      };
    }
    return { ok: true };
  };

  const frozen = payload?.mobileQtySnapshot;
  const blocks = frozen?.pickings?.length
    ? frozen.pickings
    : Array.isArray(payload?.pickings) && payload.pickings.length > 0
      ? payload.pickings
      : payload?.pickingId != null
        ? [{ deliveryLines: payload.deliveryLines, moveLineUpdates: payload.moveLineUpdates }]
        : [];

  for (const u of deliveredUpdates || []) {
    const r = checkQty(u?.qty_delivered, `SO line ${u?.lineId ?? '?'}`);
    if (!r.ok) return r;
  }

  for (const block of blocks) {
    for (const line of block.deliveryLines || []) {
      const r = checkQty(line?.qty_done, `move ${line?.moveId ?? line?.move_id ?? '?'}`);
      if (!r.ok) return r;
    }
    for (const u of block.moveLineUpdates || []) {
      const r = checkQty(u?.qty_done, `move line ${u?.moveLineId ?? '?'}`);
      if (!r.ok) return r;
    }
  }

  const requested = frozen?.requestedQtyByProduct || payload?.requestedQtyByProduct || {};
  for (const [pid, qtyRaw] of Object.entries(requested)) {
    const r = checkQty(qtyRaw, `product ${pid}`);
    if (!r.ok) return r;
  }

  return { ok: true };
}

/** Sum target qty_done per move from a picking block (mobile snapshot). */
export function targetQtyByMoveFromBlock(block = {}) {
  const map = new Map();
  for (const line of block.deliveryLines || []) {
    const mid = Number(line?.moveId ?? line?.move_id);
    const qty = coerceDeliveredQty(line?.qty_done);
    if (!Number.isFinite(mid) || mid <= 0 || !Number.isFinite(qty)) continue;
    map.set(mid, qty);
  }
  for (const u of block.moveLineUpdates || []) {
    const mid = Number(u?.moveId);
    const qty = coerceDeliveredQty(u?.qty_done);
    if (Number.isFinite(mid) && mid > 0 && Number.isFinite(qty)) map.set(mid, qty);
  }
  return map;
}

/** Merge all blocks into moveId -> qty map (last wins). */
export function targetQtyByMoveFromBlocks(blocks = []) {
  const map = new Map();
  for (const b of blocks || []) {
    for (const [mid, qty] of targetQtyByMoveFromBlock(b)) {
      map.set(mid, qty);
    }
  }
  return map;
}
